import time
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def test_app_loads(server_url, driver):
    driver.get(server_url)
    assert "Songsterr Drum Tab Downloader" in driver.title
    
    # Verify main UI elements are present
    search_tab = driver.find_element(By.ID, "tab-search")
    assert search_tab.is_displayed()

def test_theme_toggles(server_url, driver):
    driver.get(server_url)
    
    # Default is dark mode or specified by data-theme on html
    html_el = driver.find_element(By.TAG_NAME, "html")
    initial_theme = html_el.get_attribute("data-theme")
    
    # Click settings tab to check theme cards or toggle OSMD button
    settings_tab = driver.find_element(By.ID, "tab-settings")
    settings_tab.click()
    
    time.sleep(1) # wait for transition
    
    # Let's toggle the floating OSMD dark mode toggle
    osmd_toggle = driver.find_element(By.CSS_SELECTOR, ".osmd-toggle")
    osmd_toggle.click()
    
    time.sleep(1) # wait for transition
    # Console logs will be captured if any errors occur during toggle
    
def test_direct_url_download_and_render_flow(server_url, driver):
    driver.get(server_url)
    wait = WebDriverWait(driver, 30) # 30 seconds max for download and render
    
    # Switch to URL tab
    url_tab = wait.until(EC.element_to_be_clickable((By.ID, "tab-url")))
    url_tab.click()
    
    # Wait for URL panel to be visible
    wait.until(EC.visibility_of_element_located((By.ID, "panel-url")))
    
    # Enter URL
    url_input = driver.find_element(By.ID, "url-input")
    url_input.clear()
    url_input.send_keys("https://www.songsterr.com/a/wsa/toto-falling-in-between-drum-tab-s423160")
    
    download_btn = wait.until(EC.element_to_be_clickable((By.ID, "btn-download-url")))
    download_btn.click()
    
    # Now we must wait for the rendering process to finish.
    wait.until(
        lambda d: d.find_element(By.ID, "panel-result").is_displayed(),
        message="Result panel did not appear within 30 seconds."
    )
    
    # Verify OSMD container has rendered something
    osmd_container = driver.find_element(By.ID, "osmd-container")
    wait.until(
        lambda d: len(osmd_container.find_elements(By.TAG_NAME, "svg")) > 0,
        message="OSMD did not render any SVG elements."
    )
    
    # 1. Playback test
    play_btn = driver.find_element(By.ID, "btn-audio-play")
    assert play_btn.is_displayed(), "Audio play button is not displayed."
    play_btn.click()
    time.sleep(2) # let it play for 2 seconds
    
    stop_btn = driver.find_element(By.ID, "btn-audio-stop")
    assert stop_btn.is_displayed(), "Audio stop button is not displayed."
    stop_btn.click()
    time.sleep(1) # wait after stopping
    
    # 2. Toggle sheet dark mode and stem direction
    osmd_toggle = driver.find_element(By.CSS_SELECTOR, ".osmd-toggle")
    osmd_toggle.click()
    time.sleep(1)
    
    stem_toggle = driver.find_element(By.ID, "btn-toggle-stem")
    stem_toggle.click()
    time.sleep(1)
    
    # 3. Test Library flow
    # Click go back (reset UI)
    reset_btn = driver.find_element(By.CSS_SELECTOR, "button[onclick='resetUI()']")
    reset_btn.click()
    time.sleep(1) # wait for transition
    
    # Switch to Library tab
    library_tab = wait.until(EC.element_to_be_clickable((By.ID, "tab-library")))
    library_tab.click()
    wait.until(EC.visibility_of_element_located((By.ID, "panel-library")))
    
    # Check library item is listed
    library_list = driver.find_element(By.ID, "library-list")
    titles = library_list.find_elements(By.CSS_SELECTOR, "h3.text-primary.font-medium.truncate")
    assert any("Toto" in t.text or "Falling" in t.text for t in titles), "Downloaded track not found in library"
    
    # Click Re-download / Re-open button (using JS to bypass hover opacity rules)
    reopen_btn = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "button[data-tooltip='Re-open']")))
    driver.execute_script("arguments[0].click();", reopen_btn)
    
    # Wait for result panel again
    wait.until(
        lambda d: d.find_element(By.ID, "panel-result").is_displayed(),
        message="Result panel did not appear after re-opening from library."
    )
    
    # Check SVG renders again
    wait.until(
        lambda d: len(osmd_container.find_elements(By.TAG_NAME, "svg")) > 0,
        message="OSMD did not render SVG elements after re-opening."
    )

