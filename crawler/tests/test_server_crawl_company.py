"""HTTP-level tests for POST /crawler/crawl-company.

Regression coverage for the live-run defect where a non-HTTPS company URL
made the crawler answer 500 instead of 400: pydantic puts the ValueError in
``errors()[0]['ctx']['error']``, which ``jsonify`` cannot serialise.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

import server

VALID_PAYLOAD = {
    'searchId': 'sess1',
    'companyId': 'co1',
    'url': 'https://job-boards.eu.greenhouse.io/idnow',
    'companyName': 'IDnow',
    'query': 'senior product manager',
}

CRAWL_RESULT = {
    'search_id': 'sess1',
    'company_id': 'co1',
    'jobs': [],
    'discovered_companies': [],
    'errors': [],
    'unsupported': True,
}


@pytest.fixture
def client():
    server.app.config.update(TESTING=True)
    return server.app.test_client()


@pytest.fixture
def crawl_mock(monkeypatch):
    calls = []

    def fake_crawl(**kwargs):
        calls.append(kwargs)
        return dict(CRAWL_RESULT)

    monkeypatch.setattr(server, 'crawl_company_jobs', fake_crawl)
    return calls


def test_http_url_is_accepted(client, crawl_mock):
    payload = dict(VALID_PAYLOAD, url='http://job-boards.greenhouse.io/celonis')

    response = client.post('/crawler/crawl-company', json=payload)

    assert response.status_code == 200
    assert crawl_mock and crawl_mock[0]['url'] == payload['url']


def test_non_http_scheme_returns_400_json(client):
    payload = dict(VALID_PAYLOAD, url='ftp://example.com/careers')

    response = client.post('/crawler/crawl-company', json=payload)

    assert response.status_code == 400
    body = response.get_json()
    assert body['error'] == 'Request validation failed'
    # The offending value must survive into the response, i.e. it is JSON
    # serialisable — this is what used to blow up into a 500.
    assert body['detail'][0]['loc'] == ['url']
    assert 'ftp://example.com/careers' in str(body['detail'][0]['input'])


def test_missing_field_returns_400_json(client):
    payload = {k: v for k, v in VALID_PAYLOAD.items() if k != 'companyName'}

    response = client.post('/crawler/crawl-company', json=payload)

    assert response.status_code == 400
    assert response.get_json()['error'] == 'Request validation failed'
