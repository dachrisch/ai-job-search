import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from job_crawler.network_interceptor import _looks_like_job_list


def test_top_level_list_with_two_or_more_items():
    assert _looks_like_job_list([{'id': 1}, {'id': 2}]) is True


def test_top_level_list_with_one_item_is_false():
    assert _looks_like_job_list([{'id': 1}]) is False


def test_empty_list_is_false():
    assert _looks_like_job_list([]) is False


def test_dict_with_jobs_key():
    assert _looks_like_job_list({'jobs': [{'id': 1}, {'id': 2}]}) is True


def test_dict_with_postings_key():
    assert _looks_like_job_list({'postings': [{'id': 1}, {'id': 2}]}) is True


def test_dict_with_requisitions_key():
    assert _looks_like_job_list({'requisitions': [{'id': 1}, {'id': 2}]}) is True


def test_dict_with_known_key_but_only_one_item_is_false():
    assert _looks_like_job_list({'jobs': [{'id': 1}]}) is False


def test_dict_with_no_job_keys_is_false():
    assert _looks_like_job_list({'status': 'ok', 'version': 1}) is False


def test_non_dict_non_list_is_false():
    assert _looks_like_job_list('hello') is False
    assert _looks_like_job_list(42) is False
    assert _looks_like_job_list(None) is False
