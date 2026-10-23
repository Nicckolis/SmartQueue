function ConfirmPassword(password, rpassword) {
	if(password == rpassword)
	{
		return true;
	}
	else
	{
	return false;
	}
}

function CheckEmail(email, emails) {
	const domain = email.split('@')[1]; 
  	return emails.includes(domain);
}	

/*const accountStorage = new AccountManager(); */

const emails = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "aol.com",
    "hotmail.co.uk",
    "hotmail.fr",
    "msn.com",
    "yahoo.fr",
    "wanadoo.fr",
    "orange.fr",
    "comcast.net",
    "yahoo.co.uk",
    "yahoo.com.br",
    "yahoo.co.in",
    "live.com",
    "rediffmail.com",
    "free.fr",
    "gmx.de",
    "web.de",
    "yandex.ru",
    "ymail.com",
    "libero.it",
    "outlook.com",
    "uol.com.br",
    "bol.com.br",
    "mail.ru",
    "cox.net",
    "hotmail.it",
    "sbcglobal.net",
    "sfr.fr",
    "live.fr",
    "verizon.net",
    "live.co.uk",
    "googlemail.com",
    "yahoo.es",
    "ig.com.br",
    "live.nl",
    "bigpond.com",
    "terra.com.br",
    "yahoo.it",
    "neuf.fr",
    "yahoo.de",
    "alice.it",
    "rocketmail.com",
    "att.net",
    "laposte.net",
    "facebook.com",
    "bellsouth.net",
    "yahoo.in",
    "hotmail.es",
    "charter.net",
    "yahoo.ca",
    "yahoo.com.au",
    "rambler.ru",
    "hotmail.de",
    "tiscali.it",
    "shaw.ca",
    "yahoo.co.jp",
    "sky.com",
    "earthlink.net",
    "optonline.net",
    "freenet.de",
    "t-online.de",
    "aliceadsl.fr",
    "virgilio.it",
    "home.nl",
    "qq.com",
    "telenet.be",
    "me.com",
    "yahoo.com.ar",
    "tiscali.co.uk",
    "yahoo.com.mx",
    "voila.fr",
    "gmx.net",
    "mail.com",
    "planet.nl",
    "tin.it",
    "live.it",
    "ntlworld.com",
    "arcor.de",
    "yahoo.co.id",
    "frontiernet.net",
    "hetnet.nl",
    "live.com.au",
    "yahoo.com.sg",
    "zonnet.nl",
    "club-internet.fr",
    "juno.com",
    "optusnet.com.au",
    "blueyonder.co.uk",
    "bluewin.ch",
    "skynet.be",
    "sympatico.ca",
    "windstream.net",
    "mac.com",
    "centurytel.net",
    "chello.nl",
    "live.ca",
    "aim.com",
    "bigpond.net.au"
]

function onSignup(event) 
{
  event.preventDefault();
  const signEmail = document.getElementById("signemail").value;
  const signPassword = document.getElementById("spassword").value;
  const signRPassword = document.getElementById("srpassword").value;
  const errorElement = document.getElementById("signError");

  errorElement.textContent = "";
  if (!signEmail.trim() || !signPassword || !signRPassword) return errorElement.textContent = "Please fill in all fields.";
  const correctEmail = CheckEmail(signEmail, emails);
  const matchPassword = ConfirmPassword(signPassword, signRPassword);

  if (!correctEmail && !matchPassword)
  {
    errorElement.textContent = "Invalid email and passwords do not match.";
  } 

  else if (!correctEmail)
  {
    errorElement.textContent = "Please input a valid email.";
  } 
    
  else if (!matchPassword) 
  {
    errorElement.textContent = "Passwords do not match.";  
  }

  else if (accountStorage.hasAccount(signEmail)) 
  {
    errorElement.innerHTML = `An account with this email already exists, try <a href="queue-login.html">loging in instead</a>`;
  } 
    
  else 
  {
    accountStorage.setAccount(signEmail, signPassword);
    sessionStorage.setItem("accountCreated", "Account Created!");
    window.location.href = "queue-login.html";
  }
}

function onLogin(event) {
  event.preventDefault();
  const logEmail = document.getElementById("logemail").value;
  const logPassword = document.getElementById("lpassword").value;
  const errorElement = document.getElementById("logError");

  errorElement.textContent = "";
  if (!logEmail.trim() || !logPassword) return errorElement.textContent = "Please fill in all fields.";
  const correctLogin = accountStorage.checkAccount(logEmail, logPassword);

  if(!correctLogin)
  {
    errorElement.innerHTML = `Incorrect Login, if this is your first time, <a href="queue-signup.html"> Make an account</a>`;
  }

  else if(accountStorage.isAdmin(logEmail))
  {
    accountStorage.setCurrentUser(logEmail)
    window.location.href = "../Admin/admin-dashboard.html"
  }

  else
  {
    accountStorage.setCurrentUser(logEmail);
    window.location.href = "../UserDashboard/dashboard.html"
  }
}

document.getElementById("signupForm")?.addEventListener("submit", onSignup)
document.getElementById("loginForm")?.addEventListener("submit", onLogin)

const createdElement = document.getElementById("createdAccount");
if (createdElement) {
	const message = sessionStorage.getItem("accountCreated");
	if (message) {
		createdElement.textContent = message;
		sessionStorage.removeItem("accountCreated");
	}
}
