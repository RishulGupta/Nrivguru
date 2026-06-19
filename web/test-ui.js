import puppeteer from 'puppeteer';

async function testApp() {
  console.log('Launching headless browser...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (err) {
    console.error('Failed to launch headless browser.');
    process.exit(1);
  }

  const page = await browser.newPage();
  
  // Track errors
  let errorsFound = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      errorsFound.push(`Console Error: ${msg.text()}`);
    }
  });
  page.on('pageerror', error => {
    errorsFound.push(`Page Error: ${error.message}`);
  });

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });

  console.log('Bypassing Age & Consent Gates...');
  const ageGateButton = await page.$('button');
  if (ageGateButton) await ageGateButton.click();
  await new Promise(r => setTimeout(r, 500));

  const consentButton = await page.$('button');
  if (consentButton) await consentButton.click();
  await new Promise(r => setTimeout(r, 500));
  
  console.log('Creating random account to bypass Auth...');
  const email = `test_${Date.now()}@example.com`;
  const inputs = await page.$$('input');
  if (inputs.length >= 3) {
    await inputs[0].type('tester');
    await inputs[1].type(email);
    await inputs[2].type('password123');
    const buttons = await page.$$('button');
    if (buttons.length > 0) {
      await buttons[0].click(); // Sign Up
      console.log('Clicked Sign Up, waiting for redirect to /home...');
      await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    }
  }

  console.log('Current URL:', page.url());
  
  // Now we should be on /home. Let's test navigation to other features.
  console.log('Testing Home Dashboard...');
  await new Promise(r => setTimeout(r, 2000));
  let title = await page.title();

  console.log('Testing Upload Feature...');
  await page.goto('http://localhost:5173/upload', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Testing Practice Feature...');
  await page.goto('http://localhost:5173/practice', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Testing History Feature...');
  await page.goto('http://localhost:5173/history', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Testing Credits Feature...');
  await page.goto('http://localhost:5173/credits', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  await browser.close();

  console.log('\n--- TEST RESULTS ---');
  if (errorsFound.length > 0) {
    console.log('ERRORS DETECTED:');
    errorsFound.forEach(e => console.log(e));
  } else {
    console.log('SUCCESS: All features loaded with ZERO React/JS runtime errors!');
  }
}

testApp();
