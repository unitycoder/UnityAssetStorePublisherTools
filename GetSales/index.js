// 
// Unity AssetStore Publisher Tools : Fetch Sales for Current Month
// 

const secrets = require('./private/secrets.json');

const monthToFetch = `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}-01`;

const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');

// Create a cookie jar so cookies persist between requests.
const jar = new tough.CookieJar();
const client = wrapper(axios.create({
  jar,
  withCredentials: true,
}));

// These headers mimic a real browser.
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Referer': 'https://id.unity.com/',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Origin': 'https://id.unity.com',
  'Alt-Used': 'id.unity.com',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Priority': 'u=0, i',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache',
  'TE': 'trailers'
};

//console.log("\x1b[36m%s\x1b[0m", "### Unity AssetStore Publisher : Get Current Month Sales ###");

// Follow redirects manually until we get a URL containing "/conversations/"
async function getConversationUrl(initialUrl) {
  let url = initialUrl;
  const maxSteps = 10;
  for (let i = 0; i < maxSteps; i++) {
    try {
      await client.get(url, { maxRedirects: 0, headers: defaultHeaders });
      // If no redirect occurs, return this URL.
      return url;
    } catch (err) {
      if (err.response && (err.response.status === 301 || err.response.status === 302)) {
        const location = err.response.headers.location;
        //console.log(`Redirect step ${i + 1}: ${location}`);
        url = location;
        if (url.includes('/conversations/')) {
          return url;
        }
      } else {
        throw err;
      }
    }
  }
  throw new Error("Couldn't find a valid conversation URL in the redirect chain.");
}

async function loginAndFetchSales() {
  try {
    // Step 1: Get the conversation login URL.
    const initialUrl = 'https://publisher.unity.com/sales';
    const conversationUrl = await getConversationUrl(initialUrl);
    //console.log('Final conversation URL:', conversationUrl);

    // Step 2: Load the conversation login page.
    const loginPageResponse = await client.get(conversationUrl, { headers: defaultHeaders });
    const $ = cheerio.load(loginPageResponse.data);
    const authenticityToken = $('input[name="authenticity_token"]').attr('value');
    if (!authenticityToken) {
      throw new Error('Unable to extract authenticity token from the login page.');
    }
    //console.log('Extracted authenticity token:', authenticityToken);

    // Step 3: Build the login payload exactly as observed.
    const payload = new URLSearchParams();
    payload.append('utf8', '✓'); // Checkmark, URL-encoded automatically.
    payload.append('_method', 'put');
    payload.append('authenticity_token', authenticityToken);
    payload.append('conversations_create_session_form[email]', secrets.email);
    payload.append('conversations_create_session_form[password]', secrets.password);
    // Append duplicate "remember_me" fields.
    payload.append('conversations_create_session_form[remember_me]', 'false');
    payload.append('conversations_create_session_form[remember_me]', 'true');
    payload.append('commit', 'Sign in');

    //console.log('Payload to be sent:', payload.toString());

    // Step 4: Submit the login data using a POST request.
    const loginResponse = await client.post(conversationUrl, payload.toString(), { headers: defaultHeaders });
    //console.log('Login response status:', loginResponse.status);
    //console.log('Login response headers:', loginResponse.headers);
    //console.log('Login response data (HTML snippet):', loginResponse.data.substring(0, 500));

    // Step 5: Parse meta refresh from login response to get the callback URL.
    const $$ = cheerio.load(loginResponse.data);
    const metaRefresh = $$('meta[http-equiv="refresh"]').attr('content');
    if (!metaRefresh) {
      throw new Error('No meta refresh tag found in the login response.');
    }
    // Expect content like "1; url=https://publisher.unity.com/auth/callback?redirect_to=%2Fsales&code=..."
    const redirectUrl = metaRefresh.split('url=')[1].trim();
    //console.log('Meta refresh URL:', redirectUrl);

    // Step 6: Follow the meta refresh callback URL.
    const callbackResponse = await client.get(redirectUrl, { headers: defaultHeaders });
    //console.log('Callback page loaded, status:', callbackResponse.status);

    // Step 7: Load the final sales page to complete the session.
    const salesPageUrl = 'https://publisher.unity.com/sales';
    const salesPageResponse = await client.get(salesPageUrl, { headers: defaultHeaders });
    //console.log('Sales page loaded, status:', salesPageResponse.status);

    // Step 8: Extract the CSRF token from cookies.
    const cookies = await jar.getCookies('https://publisher.unity.com');
    //console.log('Cookies on publisher.unity.com:', cookies);
    const csrfCookie = cookies.find(cookie => cookie.key === '_csrf');
    if (!csrfCookie) {
      throw new Error("No _csrf cookie found; login might not be complete.");
    }
    //console.log('Extracted CSRF token from cookie:', csrfCookie.value);

    // Step 9: Fetch the monthly sales JSON using the CSRF token.
    const monthlySalesUrl = 'https://publisher.unity.com/publisher-v2-api/monthly-sales?date='+monthToFetch;
    const salesResponse = await client.get(monthlySalesUrl, {
      headers: {
        ...defaultHeaders,
        'X-Csrf-Token': csrfCookie.value,
        'X-Source': 'publisher-portal',
        'Accept': '*/*',
        'Referer': 'https://publisher.unity.com/sales'
      }
    });

	// JSON data
	console.log('Monthly Sales Data:', salesResponse.data);

	} catch (error) {
    if (error.response) {
      console.error('Error during login/fetching sales (response):', error.response.status, error.response.data);
    } else {
      console.error('Error during login/fetching sales:', error.message);
    }
  }
}

loginAndFetchSales();
