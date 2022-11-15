// ==UserScript==
// @name     Instagram content donor for RSS-Bridge
// @version  1
// @include  https://www.instagram.com/*
// @grant    GM.xmlHttpRequest
// @grant    GM.getValue
// @grant    GM.setValue
// ==/UserScript==

const USERNAME_AS_USERID_REGEX = /instagram\.com\/(\d+)/;
const WORK_PERIOD = 60*60*11; // 11 hours
const SLEEP_PERIOD = 60*60*13; // 13 hours

function now() {
  return parseInt(Date.now() / 1000);
}

async function getConfig(name) {
  let r = localStorage.getItem(name);
  if (r) {
    await GM.setValue(name, r);
    localStorage.removeItem(name);
    return r;
  } else {
    return await GM.getValue(name);
  }
}

async function setConfig(name, value) {
  localStorage.removeItem(name);
  await GM.setValue(name, value);
}

async function getState() {
  return await getConfig("RSSBRIDGE_DONOR_STATE") || 'free';
}

async function setState(state) {
  await setConfig("RSSBRIDGE_DONOR_STATE", state);
}

async function getWorkingTime() {
  const workStartTime = parseInt(await getConfig("WORK_START_TIME"));
  if (!workStartTime) {
    const n = now();
    await setConfig("WORK_START_TIME", n);
    workStartTime = n;
  }
  return now() - workStartTime;
}

let ACCESS_TOKEN;
let RSSBRIDGE_ROOT;
let MASTER_APP_URL;
let fallbackTimeout;

function sleep(s) {
  let ms = 1000*s;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _handle_http_response(resolve, reject, response) {
  if (response.status != 200) {
    reject(response);
  } else {
    try {
      resolve(JSON.parse(response.response));
    } catch(e) {
      resolve(response.response);
    }
  }
}

function get(url, headers) {
  headers = headers || {};
  if (url.startsWith(RSSBRIDGE_ROOT)) {
    headers['Authorization'] = 'Bearer ' + ACCESS_TOKEN;
  }
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "GET",
      url,
      headers: headers,
      onload: function(response) {
        _handle_http_response(resolve, reject, response);
      },
      onerror: reject
    });
  });
}

function post(url, data) {
  let headers = { "Content-type" : "application/x-www-form-urlencoded"};
  if (url.startsWith(RSSBRIDGE_ROOT)) {
    headers['Authorization'] = 'Bearer ' + ACCESS_TOKEN;
  }
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "POST",
      url,
      headers: headers,
      data: data,
      onload: function(response) {
        _handle_http_response(resolve, reject, response);
      },
      onerror: reject
    });
  });
}

var webProfileInfo;
var webProfileInfoStatus;
var _isLoggedIn;

if (!unsafeWindow.XMLHttpRequest.prototype.getResponseText) {
  unsafeWindow.XMLHttpRequest.prototype.getResponseText = Object.getOwnPropertyDescriptor(unsafeWindow.XMLHttpRequest.prototype, 'responseText').get;
}
Object.defineProperty(unsafeWindow.XMLHttpRequest.prototype, 'responseText', {
  get: exportFunction(function() {
    var responseText = unsafeWindow.XMLHttpRequest.prototype.getResponseText.call(this);
    if (this.responseURL.includes("/api/v1/users/web_profile_info/?username=")) {
      webProfileInfo = responseText;
      webProfileInfoStatus = this.status;
    } else if (this.responseURL.includes("/api/v1/web/accounts/get_encrypted_credentials/")) {
      _isLoggedIn = true;
    }
    return responseText;
  }, unsafeWindow),
  enumerable: true,
  configurable: true
});

async function pullInstagramURLToCrawl() {
  try {
    return await get(RSSBRIDGE_ROOT + '/index.php?action=pull-job-queue&channel=InstagramBridge');
  } catch (e) {
    console.error(e);
    return '';
  }
}

async function report(type, details) {
  console.log("Report:", type);
  console.log("Details:", details);
  if (!MASTER_APP_URL) {
    console.error("No MASTER_APP_URL defined");
    return {};
  }
  return await post(MASTER_APP_URL + '/report', 'type=' + encodeURIComponent(type) + '&details=' + encodeURIComponent(details));
}

async function logout() {
  let ili = await isLoggedIn();
  if (!ili) return;
  var s = document.createElement("script");
  s.src = "https://www.instagram.com/accounts/logout";
  document.head.appendChild(s);
  await sleep(3);
}

async function isLoggedIn_internal() {
  for (var i=0; i<20; i++) {
    if (location.pathname.startsWith("/accounts/")) return false;
    if (location.pathname.startsWith("/challenge/")) return true;
    if (_isLoggedIn) {
      return true;
    }
    await sleep(1);
  }
  if (location.pathname == "/") {
    return !!document.querySelector('input[placeholder="Search"]');
  } else {
    return true;
  }
  return false;
}

async function isLoggedIn() {
  console.log("checking if logged in");
  const r = await isLoggedIn_internal();
  if (r) {
    console.log("user is logged in");
  } else {
    console.log("user is NOT logged in");
  }
  return r;
}

function is429Error() {
  if (webProfileInfoStatus == 429) return true;
  let c = document.querySelector(".error-container");
  return c && c.innerText.indexOf("Please wait") > -1;
}

async function main() {
  ACCESS_TOKEN = await getConfig('ACCESS_TOKEN');
  RSSBRIDGE_ROOT = await getConfig('RSSBRIDGE_ROOT');
  MASTER_APP_URL = await getConfig('MASTER_APP_URL');
  const DONOR_STATE = await getState();

  if (!RSSBRIDGE_ROOT) {
    alert("No RSSBRIDGE_ROOT defined");
    return;
  }

  if (!ACCESS_TOKEN) {
    alert("No ACCESS_TOKEN defined");
    return;
  }

  if (MASTER_APP_URL) {
    if (MASTER_APP_URL != await getConfig("MASTER_APP_URL_CHECKED")) {
      await get(MASTER_APP_URL); // make sure TamperMonkey allows to work with MASTER_APP
      await setConfig("MASTER_APP_URL_CHECKED", MASTER_APP_URL);
    }
  }

  while(!document || !document.querySelector) {
    await sleep(1);
  }

  switch (DONOR_STATE) {
  case 'sleeping':
    let workingTime = getWorkingTime();
    while (workingTime < 0) {
      await sleep(5);
      workingTime = getWorkingTime();
    }
    await setState("free");
    return;

  case 'occupied':
    if (!(await isLoggedIn())) {
      let r = await report('login_required');
      if (r.action == 'switch_account') {
        await setState("login");
        await setConfig("username", r.username);
        await setConfig("password", r.password);
        location.pathname = "/accounts/login";
        location.reload();
      } else {
        alert("LOGIN REQUIRED");
      }
      return;
    }
    await sleep(10 + 5 * Math.random()); // give time to fetch webProfileInfo
    for(let i=0; i<30; i++) {
      if (webProfileInfoStatus > 0) break;
      await sleep(1);
    }

    if (is429Error()) {
      let r = await report('error_429', location.href);
      switch(r.action) {

      case 'sleep':
        clearTimeout(fallbackTimeout);
        await sleep(r.seconds);
        break;

      case 'switch_account':
        await logout();
        await setState("login");
        await setConfig("username", r.username);
        await setConfig("password", r.password);
        location.pathname = "/accounts/login";
        return;
      }

      clearTimeout(fallbackTimeout);
      await sleep(60*60*2);
      await setState('free');
      main();
      return;
    }

    try {
      let instagramData;
      let instagramDataStr;
      if (webProfileInfo) {
        instagramDataStr = webProfileInfo;
        instagramData = JSON.parse(webProfileInfo);
      }

      if (instagramDataStr && instagramData.data.user) {
        const username = instagramData.data.user.username;
        const userid = instagramData.data.user.id;
        await post(
          RSSBRIDGE_ROOT + "/?action=set-bridge-cache&bridge=Instagram&key=userid_" + username,
          "value=" + encodeURIComponent(userid)
        );
        await post(
          RSSBRIDGE_ROOT + "/?action=set-bridge-cache&bridge=Instagram&key=data_u_" + userid,
          "value=" + encodeURIComponent(instagramDataStr)
        );
      } else {
        await report('no_data', location.href);
      }

    } catch(e) {
      await report('error_userscript', e.stack);
      await sleep(10);
      location.reload();
      return;
    }

    await setState('free');
    window.scrollTo({"top": 500, "left": 0, "behavior": "smooth"});
    await sleep(1 + 3 * Math.random());
    document.elementFromPoint(400, 100).click();
    await sleep(3 + 3 * Math.random());


  case "free":
    let url = '';
    while(!url) {
      let workingTime = await getWorkingTime();
      if (workingTime > WORK_PERIOD) {
        await setState('sleeping');
        await setConfig('WORK_START_TIME', now() + SLEEP_PERIOD);
        main();
        return;
      }
      url = await pullInstagramURLToCrawl();
      await sleep(3);
    }

    let matches = url.match(USERNAME_AS_USERID_REGEX);
    if (matches) {
      const user_id = matches[1];
      try {
        const json = await get("https://i.instagram.com/api/v1/users/" + user_id + "/info/", {'X-IG-App-ID': '936619743392459'});
        url = "https://www.instagram.com/" + json.user.username;
      } catch (e) {
        await report('error_userscript', e.stack);
        location.reload();
        return;
      }
    }

    await setState('occupied');
    location.href = url;

    break;

  case "login":
    await sleep(10);
    if (await isLoggedIn()) {
      await setState("free");
      main();
      return;
    }

    var el = null;
    el = document.querySelector("input[name='username']");
    if (!el) {
      console.log("could not find username textbox. Redirecting");
      await sleep(3);
      location.pathname = "/accounts/login";
      return;
    }
    const username_to_login = await getConfig("username");
    const password = await getConfig("password");
    document.querySelector("input[name='username']").focus();
    document.execCommand("selectAll");
    document.execCommand("insertText", false, username_to_login);
    document.querySelector("input[name='password']").focus();
    document.execCommand("selectAll");
    document.execCommand("insertText", false, password);
    document.querySelector("button[type='submit']").click();
    await setState("free");

    // givin time to login, it will redirect automatically
    await sleep(10);

    // it could not login
    await setState("login");
    await report("error_login", username_to_login);
    await sleep(5);
    location.reload();
    return;


  default:
    alert("Unknown state: " + DONOR_STATE);
  };
};

fallbackTimeout = setTimeout( () => location.reload(), 1000*60*2 );
main();
