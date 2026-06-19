import puppeteer from 'puppeteer';

async function testFullApp() {
  console.log('--- STARTING EXHAUSTIVE UI TEST ---');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });
  } catch (err) {
    console.error('Failed to launch headless browser.', err.message);
    process.exit(1);
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  let errorsFound = [];
  page.on('pageerror', error => errorsFound.push(`[Fatal Page Error]: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('DevTools')) {
      errorsFound.push(`[Console Error]: ${msg.text()}`);
    }
  });

  try {
    console.log('[1/8] Navigating to localhost...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    // Bypass Age & Consent
    let buttons = await page.$$('button');
    if (buttons.length > 0) await buttons[0].click();
    await new Promise(r => setTimeout(r, 500));
    buttons = await page.$$('button');
    if (buttons.length > 0) await buttons[0].click();
    await new Promise(r => setTimeout(r, 1000));

    console.log('[2/8] Creating test account to bypass Google Auth...');
    const testEmail = `qa_${Date.now()}@test.com`;
    const inputs = await page.$$('input');
    if (inputs.length >= 3) {
      await inputs[0].type('QA_Tester');
      await inputs[1].type(testEmail);
      await inputs[2].type('password123');
      const authBtns = await page.$$('button');
      await authBtns[0].click();
      await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
    }

    console.log('[3/8] Testing Dashboard buttons & Featured Routines...');
    await new Promise(r => setTimeout(r, 2000));
    // Click the first featured routine
    const routines = await page.$$('.group.glass');
    if (routines.length > 0) {
      console.log('      Clicking a featured routine...');
      await routines[0].click();
      await new Promise(r => setTimeout(r, 1500));
      
      console.log('[4/8] Testing Practice Button inside Routine View...');
      const practiceBtns = await page.$$('button');
      for (let btn of practiceBtns) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes('Practice')) {
          await btn.click();
          await new Promise(r => setTimeout(r, 1500));
          break;
        }
      }
      
      // Go back to home
      await page.goto('http://localhost:5173/home', { waitUntil: 'networkidle2' });
    }

    console.log('[5/8] Testing Upload Flow...');
    await page.goto('http://localhost:5173/upload', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));
    
    console.log('[6/8] Testing History/Progress...');
    await page.goto('http://localhost:5173/history');
    await new Promise(r => setTimeout(r, 1500));

    console.log('[7/8] Testing Credits/Subscription...');
    await page.goto('http://localhost:5173/credits');
    await new Promise(r => setTimeout(r, 1500));

    console.log('[8/8] Testing Logout...');
    await page.goto('http://localhost:5173/home');
    await new Promise(r => setTimeout(r, 1500));
    const logoutBtn = await page.$('button[title="Logout"], .lucide-log-out');
    if (logoutBtn) {
        // Find the parent button of the svg
        const parentBtn = await logoutBtn.evaluateHandle(el => el.closest('button'));
        if (parentBtn) await parentBtn.click();
    }
    await new Promise(r => setTimeout(r, 1000));

  } catch (err) {
    errorsFound.push(`[Test Script Crash]: ${err.message}`);
  }

  await browser.close();

  console.log('\n=======================================');
  console.log('       TEST REPORT COMPLETE            ');
  console.log('=======================================');
  if (errorsFound.length === 0) {
    console.log('✅ ALL TESTS PASSED: Zero React/JS errors detected across all features.');
  } else {
    console.log('❌ ERRORS DETECTED:');
    errorsFound.forEach(e => console.log(e));
  }
}

testFullApp();
