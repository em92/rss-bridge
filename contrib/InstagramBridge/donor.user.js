// ==UserScript==
// @name     Instagram content donor for RSS-Bridge
// @version  1
// @include  https://www.instagram.com/*
// @grant    GM.xmlHttpRequest
// ==/UserScript==

const ACCESS_TOKEN = 'test_token';
const NODE_INDEX = 0;
const NODE_COUNT = 1;
const START_HOUR = 5;
const RSSBRIDGE_ROOT='http://localhost:82';
const INSTAGRAM_ACCOUNTS_URL=RSSBRIDGE_ROOT + '/instagram_accounts.txt';
const APP_ROOT='http://localhost:8028';
/*
Example:
const LOGINS_PASSWORDS = [
  "username1 password1",
  "username2 password2",
  "username3 password3",
];
*/
const LOGINS_PASSWORDS = [
];

function extractPreloader(text) {
  const entries = []
  const parser = new Parser(text)
  while (parser.seek('{"require":[["PolarisQueryPreloaderCache"', {moveToMatch: true, useEnd: true}) !== -1) {
    if (parser.seek('{"complete":', {moveToMatch: true, useEnd: false}) !== -1) {
      let details = parser.get({split: ',"status_code":'}) + "}}"
      let data = JSON.parse(details)
      entries.push(data)
    }
  }
  // entries now has the things
  const profileInfoResponse = entries.find(x => x.request.url === "/api/v1/users/web_profile_info/")
  if (!profileInfoResponse) {
    throw new Error("No profile info in the preloader.")
  }
  return JSON.parse(profileInfoResponse.result.response).data.user
}

/**
 * @typedef GetOptions
 * @property {string} [split] Characters to split on
 * @property {string} [mode] "until" or "between"; choose where to get the content from
 * @property {function} [transform] Transformation to apply to result before returning
 */

const tf = {
  lc: s => s.toLowerCase()
}

class Parser {
  constructor(string) {
    this.string = string;
    this.substore = [];
    this.cursor = 0;
    this.cursorStore = [];
    this.mode = "until";
    this.transform = s => s;
    this.split = " ";
  }

  /**
   * Return all the remaining text from the buffer, without updating the cursor
   * @return {String}
   */
  remaining() {
    return this.string.slice(this.cursor);
  }

  /**
   * Have we reached the end of the string yet?
   * @return {boolean}
   */
  hasRemaining() {
    return this.cursor < this.string.length
  }

  /**
   * Get the next element from the buffer, either up to a token or between two tokens, and update the cursor.
   * @param {GetOptions} [options]
   * @returns {String}
   */
  get(options = {}) {
    ["mode", "split", "transform"].forEach(o => {
      if (!options[o]) options[o] = this[o];
    });
    if (options.mode == "until") {
      let next = this.string.indexOf(options.split, this.cursor+options.split.length);
      if (next == -1) {
        let result = this.remaining();
        this.cursor = this.string.length;
        return result;
      } else {
        let result = this.string.slice(this.cursor, next);
        this.cursor = next + options.split.length;
        return options.transform(result);
      }
    } else if (options.mode == "between") {
      let start = this.string.indexOf(options.split, this.cursor);
      let end = this.string.indexOf(options.split, start+options.split.length);
      let result = this.string.slice(start+options.split.length, end);
      this.cursor = end + options.split.length;
      return options.transform(result);
    }
  }

  /**
   * Get a number of chars from the buffer.
   * @param {number} length Number of chars to get
   * @param {boolean} [move] Whether to update the cursor
   */
  slice(length, move = false) {
    let result = this.string.slice(this.cursor, this.cursor+length);
    if (move) this.cursor += length;
    return result;
  }

  /**
   * Repeatedly swallow a character.
   * @param {String} char
   */
  swallow(char) {
    let before = this.cursor;
    while (this.string[this.cursor] == char) this.cursor++;
    return this.cursor - before;
  }

  /**
   * Push the current cursor position to the store
   */
  store() {
    this.cursorStore.push(this.cursor);
  }

  /**
   * Pop the previous cursor position from the store
   */
  restore() {
    this.cursor = this.cursorStore.pop();
  }

  /**
   * Run a get operation, test against an input, return success or failure, and restore the cursor.
   * @param {String} value The value to test against
   * @param {Object} options Options for get
   */
  test(value, options) {
    this.store();
    let next = this.get(options);
    let result = next == value;
    this.restore();
    return result;
  }

  /**
   * Run a get operation, test against an input, and throw an error if it doesn't match.
   * @param {String} value
   * @param {GetOptions} [options]
   */
  expect(value, options = {}) {
    let next = this.get(options);
    if (next != value) throw new Error("Expected "+value+", got "+next);
  }

  /**
   * Seek to or past the next occurance of the string.
   * @param {string} toFind
   * @param {{moveToMatch?: boolean, useEnd?: boolean}} options both default to false
   */
  seek(toFind, options = {}) {
    if (options.moveToMatch === undefined) options.moveToMatch = false
    if (options.useEnd === undefined) options.useEnd = false
    let index = this.string.indexOf(toFind, this.cursor)
    if (index !== -1) {
      if (options.useEnd) index += toFind.length
      if (options.moveToMatch) this.cursor = index
    }
    return index
  }

  /**
   * Replace the current string, adding the old one to the substore.
   * @param {string} string
   */
  unshiftSubstore(string) {
    this.substore.unshift({string: this.string, cursor: this.cursor, cursorStore: this.cursorStore})
    this.string = string
    this.cursor = 0
    this.cursorStore = []
  }

  /**
   * Replace the current string with the first entry from the substore.
   */
  shiftSubstore() {
    Object.assign(this, this.substore.shift())
  }
}

function random_choise(choices) {
  var index = Math.floor(Math.random() * choices.length);
  return choices[index];
}

function sleep(s) {
  let ms = 1000*s;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextNumber(currentNumber) {
  let i = NODE_INDEX;
  while(i <= currentNumber) {
    i += NODE_COUNT;
  }
  return i;
}

function get(url) {
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "GET",
      url,
      onload: function(response) {
        if (response.status != 200) {
          reject(response);
        } else {
          resolve(response);
        }
      },
      onerror: reject
    });
  });
}

function post(url, data) {
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "POST",
      url,
      headers: { "Content-type" : "application/x-www-form-urlencoded" },
      data: data,
      onload: function(response) {
        if (response.status != 200) {
          reject(response);
        } else {
          resolve(response);
        }
      },
      onerror: reject
    });
  });
}

function setState(state) {
  localStorage.setItem("donor_state", state);
}

function getState() {
  return localStorage.getItem("donor_state") || "waiting_for_start";
}

function showProgress() {
  let p = localStorage.getItem("donor_progress");
  if (!p) return;
  let d = document.createElement("div");
  d.style.bottom = 0;
  d.style.right = 0;
  d.style.position = "fixed";
  d.style.backgroundColor = "red";
  d.innerHTML = p;
  document.body.appendChild(d);
}

function setProgress(p) {
  if (p) {
    localStorage.setItem("donor_progress", p);
  } else {
    localStorage.removeItem("donor_progress");
  }
}

async function fetchInstagramAccounts() {
  try {
    let accounts = (await get(INSTAGRAM_ACCOUNTS_URL + "?_=" + Date.now())).responseText.split("\n").filter(x => x).map( x => x.toLowerCase() );
    if (accounts.length == 0) {
      alert("No accounts given");
      return null;
    } else if (accounts.length < NODE_INDEX + 1) {
      alert("Excessive node");
      return null;
    }

    // remove duplicates
    accounts = [...new Set(accounts)].sort();

    return accounts;
  } catch (e) {
    console.error("DONOR ERROR: error while fetching instagram accounts", e);
    await sleep(10);
    location.reload();
    await sleep(10);
    return null;
  }
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


async function popNextInstagramAccountToCrawl() {
  let current = localStorage.getItem("current_account");
  let accounts = await fetchInstagramAccounts();

  let currentIndex = -1;
  let nextIndex = NODE_INDEX;
  if (current) {
    currentIndex = accounts.indexOf(current);
    nextIndex = nextNumber(currentIndex);
  }

  // setting progress
  setProgress("Progress: " + (nextIndex + 1).toString() + " of " + accounts.length.toString());

  if (nextIndex < accounts.length) {
    let next = accounts[nextIndex];
    localStorage.setItem("current_account", next);
    return next;
  } else {
    setProgress(false);
    localStorage.removeItem("current_account");
    return null;
  }
}

async function logout() {
  let ili = await isLoggedIn();
  if (!ili) return;
  var s = document.createElement("script");
  s.src = "https://www.instagram.com/accounts/logout";
  document.head.appendChild(s);
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
  if (location.pathname.startsWith("/challenge/")) return true;
  if (webProfileInfoStatus == 429) {
    localStorage.removeItem("too_many_requests");
    return true;
  }
  if (document.title.indexOf("Page not found") > -1) {
    var counter = parseInt(localStorage.getItem("too_many_requests")) || 0;
    if (counter > 2) {
      localStorage.removeItem("too_many_requests");
      return true;
    } else {
      localStorage.setItem("too_many_requests", counter + 1)
      return false;
    }
  }
  return false;
}

function getLoginPassword() {
  let last_lw_index = parseInt(localStorage.getItem("last_lw_index"));
  if (last_lw_index != last_lw_index) last_lw_index = 0;
  const new_lw_index = (last_lw_index + 1) % LOGINS_PASSWORDS.length;
  localStorage.setItem("last_lw_index", new_lw_index);
  return LOGINS_PASSWORDS[new_lw_index].split(" ");
}

async function main() {
  while(!document || !document.querySelector) {
    await sleep(1);
  }

  let state = getState();
  console.log("current state", state);
  if (location.pathname.startsWith("/challenge")) {
    console.log("Challenge detected. State reset");
    state = "waiting_for_start";
  }

  showProgress();
  switch(state) {
  case "waiting_for_start":
    await logout();
    while (true) {
      await sleep(2);
      const shouldStart = (await get(APP_ROOT + "/crawling/should_start")).responseText;
      if (shouldStart == 'y') {
        if (LOGINS_PASSWORDS.length > 0) {
          setState("login");
        } else {
          setState("fetch_instagram_account");
        }
        location.pathname = "/";
        return;
      }
      await sleep(8);
    }
    break;

  case "login":
    await sleep(10);
    if (await isLoggedIn()) {
      setState("get_next_instagram_account");
      location.pathname = "/";
      return;
    }
    await post(APP_ROOT + "/crawling/pong");
    let loginBtns = Array.from(document.querySelectorAll("button[type='button']")).filter( x => x.innerText == "Log In" );
    if (loginBtns.length) {
      random_choise(loginBtns).click();
    } else {
      const [username_to_login, password] = getLoginPassword();
      if (!username_to_login || !password) {
        alert("No login given");
        return;
      }
      await sleep(3);
      var el = null;
      el = document.querySelector("input[name='username']");
      if (!el) {
        console.log("could not find username textbox. Redirecting");
        await sleep(3);
        location.pathname = "/accounts/login";
        return;
      }
      document.querySelector("input[name='username']").focus();
      document.execCommand("selectAll");
      document.execCommand("insertText", false, username_to_login);
      document.querySelector("input[name='password']").focus();
      document.execCommand("selectAll");
      document.execCommand("insertText", false, password);
      document.querySelector("button[type='submit']").click();
      setState("get_next_instagram_account");
    }

    // givin time to login, it will redirect automatically
    await sleep(10);

    // it could not login
    setState("login");
    console.log("DONOR ERROR: Could not login");
    await sleep(5);
    location.reload();
    break;

  case "fetch_instagram_account":
    if (!(await isLoggedIn())) {
      setState("login");
      location.pathname = "/accounts/login";
      return;
    }
    try {
      webProfileInfo = JSON.stringify({data: {user: extractPreloader(document.documentElement.outerHTML)}});
      webProfileInfoStatus = 200;
    } catch (e) {
      console.warn(e);
    }
    let re = /[^/]+/;
    let match = location.pathname.match(re);
    if (!match || match.length > 1) {
      setState("get_next_instagram_account");
      await post(APP_ROOT + "/crawling/pong");
      if (match) {
        location.pathname = "/";
      } else {
        main();
      }
      return;
    }
    let username = match[0];

    for(let i=0; i<30; i++) {
      if (webProfileInfoStatus > 0) break;
      await sleep(1);
    }

    if (is429Error()) {
      setState("waiting_for_start"); // TODO: should not wait for time
      location.pathname = "/";
      return;
    }

    try {
      const sharedData = unsafeWindow._sharedData;
      if (sharedData && sharedData.entry_data && Object.keys(sharedData.entry_data).length > 0) {
        let r = await post(
          RSSBRIDGE_ROOT + "/?action=cache&bridge=Instagram&as_json=1&key=instagram_user_" + username,
          "value=" + encodeURIComponent(JSON.stringify(sharedData)) + "&access_token=" + encodeURIComponent(ACCESS_TOKEN)
        );
      } else if (webProfileInfo) {
        let r = await post(
          RSSBRIDGE_ROOT + "/?action=cache&bridge=Instagram&as_json=1&key=instagram_user_" + username,
          "value=" + encodeURIComponent(webProfileInfo) + "&access_token=" + encodeURIComponent(ACCESS_TOKEN)
        );
      }
    } catch(e) {
      console.error("DONOR ERROR: error while posting cache", e);
      await sleep(10);
      location.reload();
      return;
    }

    window.scrollTo({"top": 500, "left": 0, "behavior": "smooth"});
    await sleep(1 + 3 * Math.random());
    document.elementFromPoint(400, 100).click();
    await sleep(3 + 3 * Math.random());
    await post(APP_ROOT + "/crawling/pong?" + username);
    // break;

  case "get_next_instagram_account":
    let nextInstagramAccount = await popNextInstagramAccountToCrawl();
    if (!nextInstagramAccount) {
      console.log("all finished");
      setState("waiting_for_start");
      await post(APP_ROOT + "/crawling/stop");
      location.reload();
      return;
    }
    setState("fetch_instagram_account");
    location.pathname = "/" + nextInstagramAccount;
    break;

  default:
    alert("Unknown state: " + state);
    break;
  };
};

setTimeout(function() {
  location.reload();
}, 1000*70);
main();
