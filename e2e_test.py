from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    def on_error(exc):
        errors.append(str(exc))
        print(f"[PAGE ERROR] {exc}")
    page.on("pageerror", on_error)

    print("Navigating to demo mode...")
    page.goto('http://localhost:5173/chapter-player/demo?demo=1', timeout=30000)
    page.wait_for_timeout(3000)
    page.screenshot(path='test_screenshots/demo_mode.png', full_page=True)
    print("Screenshot saved: test_screenshots/demo_mode.png")

    body = page.inner_text('body')
    has_routine_not_found = 'Routine not found' in body or 'No routine' in body

    pages = page.context.pages
    print(f"Number of pages: {len(pages)}")
    print(f"Current URL: {page.url}")
    print(f"Body contains 'Routine not found': {has_routine_not_found}")

    browser.close()
    if errors:
        print(f"FAIL: {len(errors)} page errors")
        for e in errors:
            print(f"  {e}")
    elif has_routine_not_found:
        print("FAIL: Still shows 'Routine not found'")
    else:
        print("PASS: Demo loaded successfully")
