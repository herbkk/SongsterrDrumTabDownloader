import os
import time
import pytest
import threading
import logging
import sys

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from app import app as flask_app

# Disable werkzeug logging to avoid cluttering test output
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

@pytest.fixture(scope="session")
def server_url():
    port = 5001
    url = f"http://127.0.0.1:{port}"
    
    # Start flask app in a background thread
    thread = threading.Thread(
        target=flask_app.run,
        kwargs={"port": port, "use_reloader": False, "debug": False, "host": "127.0.0.1"},
        daemon=True
    )
    thread.start()
    
    # Give it a moment to start
    time.sleep(1)
    
    yield url
    # daemon thread will die when tests finish

@pytest.fixture
def driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--mute-audio")
    
    # Enable browser logging
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    driver.implicitly_wait(5)
    
    yield driver
    
    driver.quit()

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    # execute all other hooks to obtain the report object
    outcome = yield
    rep = outcome.get_result()
    # set a report attribute for each phase of a call, which can
    # be "setup", "call", "teardown"
    setattr(item, "rep_" + rep.when, rep)

@pytest.fixture(autouse=True)
def capture_console_logs(request, driver):
    yield
    # Runs during teardown of the test
    logs = driver.get_log("browser")
    if logs:
        log_dir = os.path.join(os.path.dirname(__file__), "logs")
        os.makedirs(log_dir, exist_ok=True)
        
        test_name = request.node.name
        # If test failed, mark it in the log name
        status = "FAILED" if getattr(request.node, "rep_call", None) and request.node.rep_call.failed else "PASSED"
        
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        log_file = os.path.join(log_dir, f"{test_name}_{status}_{timestamp}.log")
        
        with open(log_file, "w", encoding="utf-8") as f:
            for entry in logs:
                f.write(f"[{entry['level']}] {entry.get('source', '')}: {entry['message']}\n")
