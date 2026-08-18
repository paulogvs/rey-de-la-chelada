from pathlib import Path
from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:3102"
PWAS = ["clientes", "cocina", "bar", "meseros", "caja", "admin"]
VIEWPORTS = [
    (390, 844),
    (844, 390),
    (768, 1024),
    (1024, 768),
    (1366, 768),
]


def main():
    output = Path(".responsive-smoke")
    output.mkdir(exist_ok=True)
    failures = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        for pwa in PWAS:
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                page.goto(f"{BASE}/{pwa}/", wait_until="networkidle")
                page.screenshot(path=str(output / f"{pwa}-{width}x{height}.png"), full_page=True)
                overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
                if overflow:
                    failures.append(f"{pwa} {width}x{height}: horizontal overflow")
                if not page.locator("body").is_visible():
                    failures.append(f"{pwa} {width}x{height}: body not visible")
        browser.close()

    print(f"Checked {len(PWAS) * len(VIEWPORTS)} PWA/viewports")
    if failures:
        print("FAILURES")
        for failure in failures:
            print(failure)
        raise SystemExit(1)
    print("Responsive smoke: PASS")


if __name__ == "__main__":
    main()
