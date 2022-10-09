import queue
import subprocess
import logging
import threading
import os
from time import sleep, time
from werkzeug.exceptions import HTTPException
from werkzeug.routing import Map, Rule
from werkzeug.serving import run_simple
from werkzeug.wrappers import Response

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s.%(msecs)03d %(levelname)s %(module)s - %(funcName)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)

_logger = logging.getLogger(__name__)

DOWNLOAD_VIDEOS_CMD = ['sudo', '-u', 'www-data', '/var/www/html/rss-bridge/contrib/InstagramBridge/download_videos.sh']
CRAWLING_IN_PROGRESS = True
BROWSER_PONGED = False
USER = os.environ['USER']


def cmd(cmd):
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


video_task_queue = queue.SimpleQueue()


def open_in_browser(url):
    if os.system("xdotool search --class chromium > /dev/null") != 0:
        cmd(['chromium', 'http://localhost:8028'])
        sleep(5)
    cmd(['chromium', url])


class VideosDownloaderThread(threading.Thread):
    def run(self):
        while True:
            instagram_user = video_task_queue.get()
            _logger.info("Downloading videos for " + instagram_user)
            cmd(DOWNLOAD_VIDEOS_CMD + [instagram_user]).wait()
            _logger.info("Downloading videos for " + instagram_user + " has been finished")


class CrawlerThread(threading.Thread):
    def run(self):
        while True:
            self._run()

    def _run(self):
        global CRAWLING_IN_PROGRESS
        global BROWSER_PONGED

        while CRAWLING_IN_PROGRESS is False:
            sleep(1)

        try:
            start_time = time()

            while CRAWLING_IN_PROGRESS:
                if BROWSER_PONGED is True:
                    start_time = time()
                    BROWSER_PONGED = False

                elif time() - start_time > 60:
                    _logger.warning("No answer from usersript. Closing browser")
                    cmd(['pkill', '-U', USER, 'chromium'])
                    sleep(5)
                    open_in_browser("https://www.instagram.com")
                    start_time = time()

                sleep(1)

        except Exception:
            _logger.exception("Error in thread. Stopping crawling")
            sleep(5)
        finally:
            pass
            # cmd(["pkill", "-f", "chromium"])

        CRAWLING_IN_PROGRESS = False
        BROWSER_PONGED = False


url_map = Map([
    Rule("/crawling/start", endpoint="start"),
    Rule("/crawling/stop", endpoint="stop"),
    Rule("/crawling/pong", endpoint="pong"),
    Rule("/crawling/should_start", endpoint="should_start"),
])


def application(environ, start_response):
    global CRAWLING_IN_PROGRESS
    global BROWSER_PONGED

    try:
        urls = url_map.bind_to_environ(environ)
        endpoint, args = urls.match()

        response_text = "ok"
        if endpoint == "start":
            CRAWLING_IN_PROGRESS = True
        elif endpoint == "pong":
            if environ['QUERY_STRING'].strip():
                video_task_queue.put_nowait(environ['QUERY_STRING'])
        elif endpoint == "should_start":
            response_text = "y" if CRAWLING_IN_PROGRESS else 'n'
        elif endpoint == "stop":
            CRAWLING_IN_PROGRESS = False
        BROWSER_PONGED = True

        response = Response(response_text, mimetype="text/plain")
    except HTTPException as e:
        response = e.get_response(environ)

    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type")
    return response(environ, start_response)


if __name__ == "__main__":
    open_in_browser("https://www.instagram.com")
    crawler_thread = CrawlerThread()
    crawler_thread.start()
    vd = VideosDownloaderThread()
    vd.start()
    run_simple("127.0.0.1", 8028, application, threaded=True)
