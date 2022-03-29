// ==UserScript==
// @name     Instagram content donor for RSS-Bridge
// @version  1
// @include  https://www.instagram.com/*
// @grant    GM.xmlHttpRequest
// @grant    GM.getValue
// @grant    GM.setValue
// ==/UserScript==

const ACCESS_TOKEN = 'test_token';
const NODE_INDEX = 0;
const NODE_COUNT = 1;
const START_HOUR = 5;
const RSSBRIDGE_ROOT='http://localhost:82';
const INSTAGRAM_ACCOUNTS_URL=RSSBRIDGE_ROOT + '/instagram_accounts.txt';
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
    let accounts = (await get(INSTAGRAM_ACCOUNTS_URL + "?_=" + Date.now())).responseText.split("\n").filter(x => x);
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

function setStatus(status) {
}

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

async function isLoggedIn() {
  console.log("checking if logged in");
  for (var i=0; i<10; i++) {
    if (document.querySelector("img[data-testid='user-avatar']")) return true;
    await sleep(1);
  }
  return false;
}

function is429Error() {
  let c = document.querySelector(".error-container");
  return c && c.innerText.indexOf("Please wait") > -1;
}

async function main() {
  while(!document || !document.querySelector) {
    await sleep(1);
  }

  let currentFetchingInstagramAccount = null;
  let state = getState();
  console.log("current state", state);
  showProgress();
  switch(state) {
    case "waiting_for_start":
      await logout();
      while (true) {
        await sleep(2);
        let now = new Date();
        if (now.getHours() >= START_HOUR) {
          let responseText = random_choise(LOGINS_PASSWORDS);
          GM.setValue("lw", responseText.split(" "));
          setState("login");
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
      let loginBtns = Array.from(document.querySelectorAll("button[type='button']")).filter( x => x.innerText == "Log In" );
      if (loginBtns.length) {
        random_choise(loginBtns).click();
      } else {
      const [username_to_login, password] = await GM.getValue("lw");
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
      if (is429Error()) {
        setState("waiting_for_start");
        location.pathname = "/";
        return;
      }

      let re = /[^/]+/;
      let match = location.pathname.match(re);
      if (!match || match.length > 1) {
        setState("get_next_instagram_account");
        location.pathname = "/";
        return;
      }
      let username = match[0];
      currentFetchingInstagramAccount = username;

      try {
        let r = await post(
          RSSBRIDGE_ROOT + "/?action=cache&bridge=Instagram&as_json=1&key=instagram_user_" + username,
          "value=" + encodeURIComponent(JSON.stringify(unsafeWindow._sharedData)) + "&access_token=" + encodeURIComponent(ACCESS_TOKEN)
        );
      } catch(e) {
        console.error("DONOR ERROR: error while posting cache", e);
        await sleep(10);
        location.reload();
        return;
      }

      await sleep(10 + 5 * Math.random());
      window.scrollTo({"top": 500, "left": 0, "behavior": "smooth"});
      await sleep(1 + 3 * Math.random());
      document.elementFromPoint(400, 100).click();
      await sleep(3 + 3 * Math.random());
    // break;

    case "get_next_instagram_account":
      let nextInstagramAccount = await popNextInstagramAccountToCrawl();
      if (!nextInstagramAccount) {
        console.log("all finished");
        setState("waiting_for_start");
        while(true) {
          let now = new Date();
          if (now.getHours() < START_HOUR) {
            location.pathname = "/";
          }
          await sleep(10);
        }
      }
      setState("fetch_instagram_account");
      location.pathname = "/" + nextInstagramAccount;
    break;

    default:
      alert("Unknown state: " + state);
    break;
  };
};

main();
