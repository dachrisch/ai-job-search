import os
import json
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from cli import crawl_jobs

load_dotenv()

app = Flask(__name__)

CRAWLER_PORT = int(os.getenv('CRAWLER_PORT', 8000))


@app.route('/crawler/scrape', methods=['POST'])
def scrape():
    """
    HTTP endpoint for scraping jobs.

    Expected JSON payload:
    {
        "urls": ["https://example.com/jobs"],
        "keywords": ["Python", "JavaScript"]
    }

    Returns:
        JSON response with found count, jobs list, and newSites list
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400

        urls = data.get('urls', [])
        keywords = data.get('keywords', [])

        if not urls:
            return jsonify({'error': 'No URLs provided'}), 400

        # Call the crawler function
        result = crawl_jobs(urls, keywords)

        return jsonify(result), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=CRAWLER_PORT, debug=False)
