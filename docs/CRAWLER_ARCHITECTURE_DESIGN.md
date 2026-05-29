Perfect! Now I have a comprehensive understanding of the project. Let me create a detailed production-grade crawler service architecture design.

---

# Production-Grade Job Listing Web Crawler Service Architecture

## Executive Summary

I'm designing a **production-grade, scalable web crawler service** that integrates seamlessly with your existing job-search platform's event-driven architecture. The crawler will use **Scrapy/Python** as the core framework with a modular, extensible design pattern that enables rapid addition of new job board extractors while maintaining high performance and reliability.

**Key Design Principles:**
- **Microservice separation**: Standalone Python service (not in Node.js monorepo) communicating via REST API + BullMQ
- **Site-specific extractors**: Plugin architecture with dedicated extractors for LinkedIn, Indeed, Glassdoor, and generic fallback
- **Resilience-first**: Graceful error handling, partial result returns, intelligent retry logic
- **Performance-optimized**: Concurrent scraping, connection pooling, smart caching
- **Production-ready**: Comprehensive logging, metrics, monitoring hooks, deployment-ready

---

## 1. CRAWLER SERVICE ARCHITECTURE

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                     JOB SEARCH PLATFORM                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────┐          ┌───────────────────────────┐   │
│  │   Express API        │          │   React Frontend          │   │
│  │   (Node.js)          │          │   (Port 5173)             │   │
│  │   Port 3000          │          └───────────────────────────┘   │
│  └──────────┬───────────┘                                            │
│             │                                                         │
│      ┌──────▼─────────┐                                              │
│      │  BullMQ Queue  │◄─────────────────────────┐                  │
│      │  (Redis 6379)  │                          │                  │
│      └──────┬─────────┘                          │                  │
│             │                                    │                  │
│      crawl_requested │ Event                 Webhook                │
│             │        │                  (crawl_complete)            │
│             ▼        │                          │                  │
│  ┌──────────────────────────────────────────────┼──────┐           │
│  │                                              │      │           │
│  │   ┌─────────────────────────────────────────┘      │           │
│  │   │                                                  │           │
│  └───┼──────────────────────────────────────────────────┘           │
│      │                                                               │
│      │ HTTP Request                                                 │
│      ▼                                                               │
└─────────────────────────────────────────────────────────────────────┘
      │
      │  POST /crawler/scrape
      │  { searchId, sites, keywords, config }
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│              CRAWLER SERVICE (Python/Scrapy)                         │
│              Port 8000                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Flask HTTP Server                                │  │
│  │  /crawler/scrape (async request dispatcher)                  │  │
│  │  /crawler/health (health check)                              │  │
│  │  /crawler/status/{request_id} (async status polling)         │  │
│  └──────────────────┬───────────────────────────────────────────┘  │
│                     │                                                │
│  ┌──────────────────▼───────────────────────────────────────────┐  │
│  │           Crawler Engine (Orchestrator)                       │  │
│  │  - Request dispatcher                                         │  │
│  │  - Timeout management                                         │  │
│  │  - Result aggregator                                          │  │
│  │  - Error handler                                              │  │
│  └──────────────────┬───────────────────────────────────────────┘  │
│                     │                                                │
│  ┌──────────────────▼───────────────────────────────────────────┐  │
│  │      Site-Specific Extractors (Plugin Pattern)                │  │
│  │                                                                │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │  │
│  │  │ LinkedInSpider │  │  IndeedSpider  │  │ GlassdoorAPI │   │  │
│  │  │                │  │                │  │              │   │  │
│  │  │ Rendered HTML  │  │  Static HTML   │  │  REST API    │   │  │
│  │  │ Pagination     │  │  Pagination    │  │  JSON Parse  │   │  │
│  │  │ 10-15s per req │  │ 10-15s per req │  │ 5-10s per req│   │  │
│  │  └────────────────┘  └────────────────┘  └──────────────┘   │  │
│  │                                                                │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │         GenericExtractor (Fallback)                     │  │  │
│  │  │  - CSS selector based extraction                        │  │  │
│  │  │  - Supports any HTML-based job board                    │  │  │
│  │  │  - 15-20s per request                                   │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────┬───────────────────────────────────────────┘  │
│                     │                                                │
│  ┌──────────────────▼───────────────────────────────────────────┐  │
│  │         Job Validation & Deduplication Layer                  │  │
│  │  - Schema validation (title, company, url, etc.)              │  │
│  │  - URL deduplication within batch                             │  │
│  │  - Quality scoring                                             │  │
│  │  - Field normalization                                         │  │
│  └──────────────────┬───────────────────────────────────────────┘  │
│                     │                                                │
│  ┌──────────────────▼───────────────────────────────────────────┐  │
│  │      Result Aggregator & Cache Layer                          │  │
│  │  - Redis cache (duplicate detection across requests)          │  │
│  │  - Result aggregation from parallel spiders                   │  │
│  │  - Performance metrics collection                             │  │
│  └──────────────────┬───────────────────────────────────────────┘  │
│                     │                                                │
│  ┌──────────────────▼───────────────────────────────────────────┐  │
│  │      Request/Response Formatter                               │  │
│  │  - JSON schema validation                                     │  │
│  │  - Response formatting                                        │  │
│  │  - Error serialization                                        │  │
│  └──────────────────┬───────────────────────────────────────────┘  │
│                     │                                                │
│  ┌──────────────────▼───────────────────────────────────────────┐  │
│  │      Logging & Observability                                  │  │
│  │  - Structured logging (ECS format)                            │  │
│  │  - Performance metrics (timing, success rates)                │  │
│  │  - Error tracking                                             │  │
│  │  - Request tracing                                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │      External Services                                        │  │
│  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐ │  │
│  │  │  Redis Cache │  │  Playwright    │  │   Rate Limiter   │ │  │
│  │  │  (6379)      │  │  (headless)    │  │   (in-memory)    │ │  │
│  │  │              │  │  [Optional]    │  │                  │ │  │
│  │  └──────────────┘  └────────────────┘  └──────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
crawler/
├── server.py                 # Flask HTTP server & routing
├── requirements.txt          # Python dependencies
├── config.py                 # Configuration (timeouts, retries, etc.)
├── logger.py                 # Structured logging setup
├── metrics.py                # Performance metrics collection
│
├── core/
│   ├── __init__.py
│   ├── orchestrator.py       # Main crawler engine, request dispatcher
│   ├── validator.py          # Job schema validation
│   ├── deduplicator.py       # URL & job deduplication logic
│   ├── result_aggregator.py  # Consolidate results from spiders
│   └── cache.py              # Redis cache layer
│
├── extractors/
│   ├── __init__.py
│   ├── base_extractor.py     # Abstract base class
│   ├── linkedin_extractor.py # LinkedIn-specific logic
│   ├── indeed_extractor.py   # Indeed-specific logic
│   ├── glassdoor_extractor.py # Glassdoor-specific logic
│   └── generic_extractor.py  # Fallback HTML parser
│
├── models/
│   ├── __init__.py
│   ├── job.py                # Job data model & validation
│   ├── request.py            # Crawler request schema
│   └── response.py           # Response schema
│
├── spiders/
│   ├── __init__.py
│   ├── base_spider.py        # Scrapy Spider base
│   ├── linkedin_spider.py    # LinkedIn Scrapy implementation
│   ├── indeed_spider.py      # Indeed Scrapy implementation
│   └── generic_spider.py     # Generic HTML spider
│
├── middleware/
│   ├── __init__.py
│   ├── rate_limiter.py       # Token bucket rate limiting
│   ├── error_handler.py      # Exception handling
│   └── retry_handler.py      # Retry logic with backoff
│
├── scrapy_project/           # Scrapy project structure
│   ├── settings.py           # Scrapy configuration
│   └── pipelines.py          # Item processing
│
└── tests/
    ├── __init__.py
    ├── test_extractors.py
    ├── test_orchestrator.py
    ├── test_validation.py
    └── fixtures/             # Mock HTML/JSON responses
```

---

## 2. SITE-SPECIFIC EXTRACTOR DESIGN PATTERN

### Extractor Architecture

```python
# core/base_extractor.py
from abc import ABC, abstractmethod
from typing import List, Optional
from models.job import Job

class BaseExtractor(ABC):
    """Abstract base class for all job board extractors"""
    
    def __init__(self, timeout: int = 15000, max_retries: int = 2):
        self.timeout = timeout
        self.max_retries = max_retries
        self.metrics = {
            'requests_made': 0,
            'jobs_extracted': 0,
            'extraction_time_ms': 0,
            'errors': []
        }
    
    @abstractmethod
    def can_handle(self, domain: str) -> bool:
        """Determine if this extractor can handle the domain"""
        pass
    
    @abstractmethod
    async def extract(
        self, 
        url: str, 
        keywords: str,
        user_agent: Optional[str] = None
    ) -> tuple[List[Job], List[dict]]:
        """
        Extract jobs from URL
        
        Returns:
            (jobs: List[Job], errors: List[dict])
        """
        pass
    
    def validate_job(self, job_data: dict) -> Optional[Job]:
        """
        Validate and construct Job object
        
        Returns None if validation fails
        """
        try:
            required_fields = ['title', 'company', 'url', 'description', 'location']
            if not all(field in job_data for field in required_fields):
                return None
            
            # Validate URLs
            if not self._is_valid_url(job_data['url']):
                return None
            
            # Normalize data
            job = Job(
                title=job_data['title'].strip(),
                company=job_data['company'].strip(),
                url=job_data['url'].strip(),
                description=job_data['description'].strip(),
                location=job_data['location'].strip(),
                salary=job_data.get('salary', '').strip() or None,
                sourceUrl=job_data.get('sourceUrl', '').strip() or job_data['url']
            )
            
            return job if self._validate_job(job) else None
        except Exception as e:
            self.metrics['errors'].append({
                'type': 'validation_error',
                'message': str(e)
            })
            return None
    
    def _validate_job(self, job: Job) -> bool:
        """
        Validate job data quality
        - URL length >= 10
        - Description length >= 50
        - Title/Company not empty
        """
        return (
            len(job.url) >= 10 and
            len(job.description) >= 50 and
            len(job.title) > 0 and
            len(job.company) > 0
        )
    
    @staticmethod
    def _is_valid_url(url: str) -> bool:
        try:
            from urllib.parse import urlparse
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except:
            return False
```

### LinkedIn Extractor Implementation

```python
# extractors/linkedin_extractor.py
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import asyncio
from typing import List, Optional
from core.base_extractor import BaseExtractor
from models.job import Job

class LinkedInExtractor(BaseExtractor):
    """Extracts jobs from LinkedIn using Selenium (JavaScript rendering)"""
    
    def can_handle(self, domain: str) -> bool:
        return 'linkedin.com' in domain.lower()
    
    async def extract(
        self, 
        url: str, 
        keywords: str,
        user_agent: Optional[str] = None
    ) -> tuple[List[Job], List[dict]]:
        """
        Extract LinkedIn jobs via Selenium
        
        LinkedIn renders job listings with JavaScript, so we need a headless browser.
        Typical extraction time: 10-15 seconds per request
        """
        jobs = []
        errors = []
        
        driver = None
        try:
            # Setup Selenium with Chrome options for headless mode
            options = webdriver.ChromeOptions()
            options.add_argument('--headless')
            options.add_argument('--no-sandbox')
            options.add_argument('--disable-dev-shm-usage')
            options.add_argument(f'user-agent={user_agent or self._default_user_agent()}')
            
            driver = webdriver.Chrome(options=options)
            driver.set_page_load_timeout(self.timeout // 1000)
            
            self.metrics['requests_made'] += 1
            start_time = time.time()
            
            # Navigate to job listing page
            job_url = f"{url}?keywords={keywords}"
            driver.get(job_url)
            
            # Wait for job listings to load (max 10 seconds)
            wait = WebDriverWait(driver, 10)
            job_elements = wait.until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, 'jobs-search__results-list li'))
            )
            
            # Extract jobs from page
            for job_elem in job_elements[:20]:  # Limit to 20 per page
                try:
                    job_data = {
                        'title': job_elem.find_element(By.CLASS_NAME, 'job-card-title').text,
                        'company': job_elem.find_element(By.CLASS_NAME, 'job-card-company-name').text,
                        'url': job_elem.find_element(By.TAG_NAME, 'a').get_attribute('href'),
                        'description': job_elem.find_element(By.CLASS_NAME, 'job-card-snippet').text,
                        'location': job_elem.find_element(By.CLASS_NAME, 'job-card-location').text,
                        'salary': self._extract_salary(job_elem),
                        'sourceUrl': 'https://linkedin.com'
                    }
                    
                    job = self.validate_job(job_data)
                    if job:
                        jobs.append(job)
                        self.metrics['jobs_extracted'] += 1
                    
                except Exception as e:
                    errors.append({
                        'message': f'Failed to extract job element: {str(e)}',
                        'site': 'linkedin.com',
                        'severity': 'warning'
                    })
                    continue
            
            self.metrics['extraction_time_ms'] += int((time.time() - start_time) * 1000)
            
        except Exception as e:
            errors.append({
                'message': f'LinkedIn extraction failed: {str(e)}',
                'site': 'linkedin.com',
                'severity': 'error'
            })
            
        finally:
            if driver:
                driver.quit()
        
        return jobs, errors
    
    def _extract_salary(self, job_elem) -> Optional[str]:
        """Extract salary if available"""
        try:
            return job_elem.find_element(By.CLASS_NAME, 'job-card-salary').text
        except:
            return None
    
    @staticmethod
    def _default_user_agent() -> str:
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
```

### Indeed Extractor Implementation

```python
# extractors/indeed_extractor.py
import aiohttp
from bs4 import BeautifulSoup
from typing import List, Optional
from core.base_extractor import BaseExtractor
from models.job import Job

class IndeedExtractor(BaseExtractor):
    """Extracts jobs from Indeed (static HTML + pagination)"""
    
    def can_handle(self, domain: str) -> bool:
        return 'indeed.com' in domain.lower()
    
    async def extract(
        self, 
        url: str, 
        keywords: str,
        user_agent: Optional[str] = None
    ) -> tuple[List[Job], List[dict]]:
        """
        Extract Indeed jobs via HTTP requests
        
        Indeed uses static HTML, making extraction fast (~10-15s per request)
        """
        jobs = []
        errors = []
        
        try:
            headers = {
                'User-Agent': user_agent or self._default_user_agent(),
                'Accept-Language': 'en-US,en;q=0.9'
            }
            
            async with aiohttp.ClientSession() as session:
                self.metrics['requests_made'] += 1
                
                # Construct Indeed search URL
                search_url = f"{url}?q={keywords.replace(' ', '+')}"
                
                try:
                    async with session.get(
                        search_url,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self.timeout // 1000)
                    ) as response:
                        
                        if response.status != 200:
                            errors.append({
                                'message': f'HTTP {response.status} from Indeed',
                                'site': 'indeed.com',
                                'severity': 'error'
                            })
                            return jobs, errors
                        
                        html = await response.text()
                        soup = BeautifulSoup(html, 'html.parser')
                        
                        # Find job card containers
                        job_cards = soup.find_all('div', class_='job_seen_beacon')
                        
                        for card in job_cards[:20]:  # Limit to 20
                            try:
                                job_data = self._extract_job_from_card(card)
                                
                                if job_data:
                                    job = self.validate_job(job_data)
                                    if job:
                                        jobs.append(job)
                                        self.metrics['jobs_extracted'] += 1
                                
                            except Exception as e:
                                errors.append({
                                    'message': f'Job extraction error: {str(e)}',
                                    'site': 'indeed.com',
                                    'severity': 'warning'
                                })
                                continue
                
                except asyncio.TimeoutError:
                    errors.append({
                        'message': 'Request timeout to Indeed',
                        'site': 'indeed.com',
                        'severity': 'error'
                    })
                except aiohttp.ClientError as e:
                    errors.append({
                        'message': f'HTTP client error: {str(e)}',
                        'site': 'indeed.com',
                        'severity': 'error'
                    })
        
        except Exception as e:
            errors.append({
                'message': f'Indeed extraction failed: {str(e)}',
                'site': 'indeed.com',
                'severity': 'error'
            })
        
        return jobs, errors
    
    def _extract_job_from_card(self, card) -> Optional[dict]:
        """Extract job data from Indeed job card"""
        try:
            title_elem = card.find('h2', class_='jobTitle')
            if not title_elem:
                return None
            
            company_elem = card.find('span', class_='companyName')
            location_elem = card.find('div', class_='companyLocation')
            description_elem = card.find('div', class_='job-snippet')
            
            return {
                'title': title_elem.get_text(strip=True),
                'company': company_elem.get_text(strip=True) if company_elem else 'Unknown',
                'url': title_elem.find('a')['href'] if title_elem.find('a') else '',
                'description': description_elem.get_text(strip=True) if description_elem else '',
                'location': location_elem.get_text(strip=True) if location_elem else 'Remote',
                'salary': self._extract_salary(card),
                'sourceUrl': 'https://indeed.com'
            }
        except:
            return None
    
    def _extract_salary(self, card) -> Optional[str]:
        """Extract salary range if available"""
        try:
            salary_elem = card.find('div', class_='metadata salary-snippet-container')
            return salary_elem.get_text(strip=True) if salary_elem else None
        except:
            return None
    
    @staticmethod
    def _default_user_agent() -> str:
        return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
```

### Generic Extractor (Fallback)

```python
# extractors/generic_extractor.py
import aiohttp
from bs4 import BeautifulSoup
from typing import List, Optional
from core.base_extractor import BaseExtractor
from models.job import Job

class GenericExtractor(BaseExtractor):
    """
    Generic CSS selector-based extractor for any HTML job board
    
    Uses common CSS class patterns to extract job data
    """
    
    # Common CSS patterns for job boards
    SELECTORS = {
        'jobs_container': [
            'div.job', 'div.job-listing', 'div.job-card',
            'article.job', 'li.job-item', 'div[data-job]'
        ],
        'title': [
            'h1', 'h2', '.job-title', '.title', '[data-title]'
        ],
        'company': [
            '.company', '.company-name', '.employer', '[data-company]'
        ],
        'description': [
            '.description', '.summary', '.job-description', 'p'
        ],
        'location': [
            '.location', '.job-location', '.place', '[data-location]'
        ],
        'url': ['a.job-link', 'a', '[data-url]']
    }
    
    def can_handle(self, domain: str) -> bool:
        """Generic extractor handles any domain"""
        return True  # Always available as fallback
    
    async def extract(
        self, 
        url: str, 
        keywords: str,
        user_agent: Optional[str] = None
    ) -> tuple[List[Job], List[dict]]:
        """
        Generic job extraction using CSS selectors
        """
        jobs = []
        errors = []
        
        try:
            headers = {
                'User-Agent': user_agent or self._default_user_agent()
            }
            
            async with aiohttp.ClientSession() as session:
                self.metrics['requests_made'] += 1
                
                try:
                    async with session.get(
                        url,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self.timeout // 1000)
                    ) as response:
                        
                        if response.status != 200:
                            errors.append({
                                'message': f'HTTP {response.status}',
                                'site': url,
                                'severity': 'error'
                            })
                            return jobs, errors
                        
                        html = await response.text()
                        soup = BeautifulSoup(html, 'html.parser')
                        
                        # Find job containers
                        for container_selector in self.SELECTORS['jobs_container']:
                            job_containers = soup.select(container_selector)
                            
                            if job_containers:
                                for container in job_containers[:20]:
                                    try:
                                        job_data = self._extract_from_container(container)
                                        if job_data:
                                            job = self.validate_job(job_data)
                                            if job:
                                                jobs.append(job)
                                                self.metrics['jobs_extracted'] += 1
                                    except Exception as e:
                                        continue
                                
                                break  # Found working selector
                
                except asyncio.TimeoutError:
                    errors.append({
                        'message': 'Request timeout',
                        'site': url,
                        'severity': 'error'
                    })
                except aiohttp.ClientError as e:
                    errors.append({
                        'message': f'HTTP error: {str(e)}',
                        'site': url,
                        'severity': 'error'
                    })
        
        except Exception as e:
            errors.append({
                'message': f'Generic extraction failed: {str(e)}',
                'site': url,
                'severity': 'error'
            })
        
        return jobs, errors
    
    def _extract_from_container(self, container) -> Optional[dict]:
        """Extract job from a container element"""
        try:
            def find_text(selectors):
                for selector in selectors:
                    elem = container.select_one(selector)
                    if elem:
                        text = elem.get_text(strip=True)
                        if text:
                            return text
                return None
            
            title = find_text(self.SELECTORS['title'])
            company = find_text(self.SELECTORS['company'])
            description = find_text(self.SELECTORS['description'])
            location = find_text(self.SELECTORS['location'])
            
            url_elem = container.select_one(self.SELECTORS['url'][0]) or container.find('a')
            url = url_elem['href'] if url_elem and url_elem.get('href') else None
            
            if not all([title, company, url, description]):
                return None
            
            return {
                'title': title,
                'company': company,
                'url': url,
                'description': description,
                'location': location or 'Not specified',
                'salary': None,
                'sourceUrl': container.get('data-source') or 'unknown'
            }
        except:
            return None
    
    @staticmethod
    def _default_user_agent() -> str:
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
```

---

## 3. JOB VALIDATION AND DEDUPLICATION LOGIC

### Data Models

```python
# models/job.py
from dataclasses import dataclass, asdict
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, HttpUrl, Field, validator

@dataclass
class Job:
    """Job listing data model"""
    title: str
    company: str
    url: str
    description: str
    location: str
    sourceUrl: str
    salary: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)

class JobRequest(BaseModel):
    """Validated crawler request schema"""
    searchId: str
    sites: list[str] = Field(..., min_items=1)
    keywords: str = Field(..., min_length=1)
    config: Optional[dict] = Field(default={})
    
    @validator('sites')
    def validate_sites(cls, v):
        return [site.lower() for site in v]

class JobResponse(BaseModel):
    """Crawler response schema"""
    source: str
    jobs: list[dict]
    errors: list[dict] = []
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metrics: Optional[dict] = None
    
    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}

class ValidationResult(BaseModel):
    """Result of job validation"""
    valid: bool
    errors: list[str] = []
    job: Optional[Job] = None
    quality_score: float = 0.0  # 0.0 - 1.0
```

### Validation Service

```python
# core/validator.py
import re
from typing import Optional, List, Tuple
from models.job import Job, ValidationResult
from urllib.parse import urlparse

class JobValidator:
    """
    Validates job data quality and schema compliance
    
    Rules:
    - All required fields must be present and non-empty
    - URL must be valid HTTP/HTTPS
    - Description must be at least 50 characters
    - Title/Company must be at least 2 characters
    """
    
    QUALITY_WEIGHTS = {
        'has_url': 0.25,
        'has_description_min_length': 0.20,
        'has_salary': 0.15,
        'has_location': 0.15,
        'description_length': 0.15,
        'title_length': 0.10
    }
    
    def validate(self, job_data: dict) -> ValidationResult:
        """
        Comprehensive job validation
        
        Returns ValidationResult with:
        - valid: Boolean indicating if job passed all checks
        - errors: List of validation errors
        - job: Job object if valid
        - quality_score: 0.0-1.0 indicating data quality
        """
        errors = []
        quality_score = 0.0
        job = None
        
        # Check required fields
        required_fields = ['title', 'company', 'url', 'description', 'location', 'sourceUrl']
        for field in required_fields:
            if field not in job_data or not job_data[field]:
                errors.append(f'Missing required field: {field}')
        
        if errors:
            return ValidationResult(valid=False, errors=errors, job=None)
        
        # Normalize strings
        title = job_data['title'].strip() if isinstance(job_data['title'], str) else str(job_data['title'])
        company = job_data['company'].strip() if isinstance(job_data['company'], str) else str(job_data['company'])
        url = job_data['url'].strip() if isinstance(job_data['url'], str) else str(job_data['url'])
        description = job_data['description'].strip() if isinstance(job_data['description'], str) else str(job_data['description'])
        location = job_data['location'].strip() if isinstance(job_data['location'], str) else str(job_data['location'])
        
        # Validate length constraints
        if len(title) < 2:
            errors.append('Title too short (min 2 chars)')
        if len(company) < 2:
            errors.append('Company too short (min 2 chars)')
        if len(description) < 50:
            errors.append('Description too short (min 50 chars)')
        
        # Validate URL
        if not self._is_valid_url(url):
            errors.append('Invalid URL format')
        
        if errors:
            return ValidationResult(valid=False, errors=errors, job=None)
        
        # Validation passed, calculate quality score
        quality_score = self._calculate_quality_score(job_data, title, description)
        
        # Create job object
        job = Job(
            title=title,
            company=company,
            url=url,
            description=description,
            location=location,
            sourceUrl=job_data.get('sourceUrl', url),
            salary=job_data.get('salary', '').strip() or None
        )
        
        return ValidationResult(
            valid=True,
            errors=[],
            job=job,
            quality_score=quality_score
        )
    
    def _calculate_quality_score(self, job_data: dict, title: str, description: str) -> float:
        """Calculate quality score (0.0 - 1.0)"""
        score = 0.0
        
        # URL presence
        if job_data.get('url'):
            score += self.QUALITY_WEIGHTS['has_url']
        
        # Description length
        if len(description) >= 100:
            score += self.QUALITY_WEIGHTS['has_description_min_length']
        elif len(description) >= 50:
            score += self.QUALITY_WEIGHTS['has_description_min_length'] * 0.7
        
        # Salary presence (bonus)
        if job_data.get('salary'):
            score += self.QUALITY_WEIGHTS['has_salary']
        
        # Location presence
        if job_data.get('location'):
            score += self.QUALITY_WEIGHTS['has_location']
        
        # Description length bonus
        description_length_ratio = min(len(description) / 500, 1.0)  # Max at 500 chars
        score += self.QUALITY_WEIGHTS['description_length'] * description_length_ratio
        
        # Title length bonus
        title_length_ratio = min(len(title) / 100, 1.0)  # Max at 100 chars
        score += self.QUALITY_WEIGHTS['title_length'] * title_length_ratio
        
        return min(score, 1.0)  # Cap at 1.0
    
    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Validate URL format"""
        try:
            result = urlparse(url)
            return bool(result.scheme in ('http', 'https') and result.netloc)
        except:
            return False
```

### Deduplication Service

```python
# core/deduplicator.py
import hashlib
from typing import List, Set, Tuple, Dict
from models.job import Job
import aioredis

class JobDeduplicator:
    """
    Deduplicates jobs within batch and across Redis cache
    
    Strategies:
    1. Within-batch: URL-based deduplication
    2. Cross-request: Redis cache of URLs from past 24 hours
    3. Fuzzy matching: Similar titles/descriptions (future)
    """
    
    def __init__(self, redis_client: Optional[aioredis.Redis] = None):
        self.redis = redis_client
        self.url_cache: Set[str] = set()  # In-memory cache
    
    async def deduplicate_batch(
        self, 
        jobs: List[Job], 
        searchId: str
    ) -> Tuple[List[Job], int]:
        """
        Deduplicate jobs within a batch
        
        Returns:
            (deduplicated_jobs, duplicates_removed)
        """
        seen_urls: Set[str] = set()
        unique_jobs = []
        duplicates_removed = 0
        
        for job in jobs:
            # Normalize URL for comparison
            normalized_url = self._normalize_url(job.url)
            
            # Check within-batch duplicates
            if normalized_url in seen_urls:
                duplicates_removed += 1
                continue
            
            # Check Redis cache (if available)
            if self.redis:
                cache_key = f"job_url:{self._hash_url(normalized_url)}"
                exists = await self.redis.exists(cache_key)
                if exists:
                    duplicates_removed += 1
                    continue
            
            seen_urls.add(normalized_url)
            unique_jobs.append(job)
            
            # Add to Redis cache (24 hour TTL)
            if self.redis:
                cache_key = f"job_url:{self._hash_url(normalized_url)}"
                await self.redis.setex(
                    cache_key,
                    86400,  # 24 hours
                    job.url
                )
        
        return unique_jobs, duplicates_removed
    
    async def is_duplicate(self, job: Job, searchId: str) -> bool:
        """Check if job is a duplicate"""
        normalized_url = self._normalize_url(job.url)
        
        if self.redis:
            cache_key = f"job_url:{self._hash_url(normalized_url)}"
            return await self.redis.exists(cache_key) > 0
        
        return False
    
    @staticmethod
    def _normalize_url(url: str) -> str:
        """Normalize URL for comparison (lowercase, remove fragments)"""
        from urllib.parse import urlparse, urlunparse
        
        parsed = urlparse(url.lower())
        # Remove fragment and sort query params
        normalized = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            parsed.query,
            ''  # No fragment
        ))
        return normalized
    
    @staticmethod
    def _hash_url(url: str) -> str:
        """Create hash of URL for Redis storage"""
        return hashlib.sha256(url.encode()).hexdigest()
```

---

## 4. ERROR HANDLING AND RETRY STRATEGY

### Error Classification

```python
# middleware/error_handler.py
from enum import Enum
from typing import Optional, Dict, Any
import time

class ErrorSeverity(Enum):
    """Error severity levels"""
    INFO = 'info'           # Non-critical, operation continues
    WARNING = 'warning'     # Partial failure, some data recovered
    ERROR = 'error'         # Operation failed, retry possible
    FATAL = 'fatal'         # Unrecoverable error, abort

class ErrorCategory(Enum):
    """Error categories for classification"""
    TIMEOUT = 'timeout'                    # Request timeout
    RATE_LIMIT = 'rate_limit'              # HTTP 429
    AUTHENTICATION = 'authentication'      # HTTP 401/403
    NOT_FOUND = 'not_found'                # HTTP 404
    SERVER_ERROR = 'server_error'          # HTTP 5xx
    NETWORK_ERROR = 'network_error'        # Connection issues
    PARSING_ERROR = 'parsing_error'        # HTML/JSON parsing failed
    VALIDATION_ERROR = 'validation_error'  # Data validation failed
    UNKNOWN = 'unknown'                    # Unknown error

class CrawlerError:
    """Standardized error representation"""
    
    def __init__(
        self,
        message: str,
        category: ErrorCategory,
        severity: ErrorSeverity,
        site: Optional[str] = None,
        statusCode: Optional[int] = None,
        originalError: Optional[Exception] = None,
        retryable: bool = False,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.category = category
        self.severity = severity
        self.site = site
        self.statusCode = statusCode
        self.originalError = originalError
        self.retryable = retryable
        self.metadata = metadata or {}
        self.timestamp = time.time()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'message': self.message,
            'category': self.category.value,
            'severity': self.severity.value,
            'site': self.site,
            'statusCode': self.statusCode,
            'retryable': self.retryable,
            'timestamp': self.timestamp
        }

class ErrorHandler:
    """
    Centralized error handling and classification
    
    Maps HTTP status codes, exceptions to structured errors
    """
    
    @staticmethod
    def from_http_status(
        status_code: int,
        site: str,
        response_text: Optional[str] = None
    ) -> CrawlerError:
        """Classify error based on HTTP status code"""
        
        if status_code == 408 or status_code == 504:
            return CrawlerError(
                message=f'Request timeout (HTTP {status_code})',
                category=ErrorCategory.TIMEOUT,
                severity=ErrorSeverity.ERROR,
                site=site,
                statusCode=status_code,
                retryable=True
            )
        
        elif status_code == 429:
            return CrawlerError(
                message='Rate limited by server',
                category=ErrorCategory.RATE_LIMIT,
                severity=ErrorSeverity.WARNING,
                site=site,
                statusCode=status_code,
                retryable=True,
                metadata={'suggested_delay': 60}
            )
        
        elif status_code in [401, 403]:
            return CrawlerError(
                message=f'Authentication failed (HTTP {status_code})',
                category=ErrorCategory.AUTHENTICATION,
                severity=ErrorSeverity.WARNING,
                site=site,
                statusCode=status_code,
                retryable=False
            )
        
        elif status_code == 404:
            return CrawlerError(
                message='Job board page not found',
                category=ErrorCategory.NOT_FOUND,
                severity=ErrorSeverity.WARNING,
                site=site,
                statusCode=status_code,
                retryable=False
            )
        
        elif status_code >= 500:
            return CrawlerError(
                message=f'Server error (HTTP {status_code})',
                category=ErrorCategory.SERVER_ERROR,
                severity=ErrorSeverity.ERROR,
                site=site,
                statusCode=status_code,
                retryable=True,
                metadata={'suggested_delay': 30}
            )
        
        else:
            return CrawlerError(
                message=f'HTTP error {status_code}',
                category=ErrorCategory.UNKNOWN,
                severity=ErrorSeverity.WARNING,
                site=site,
                statusCode=status_code,
                retryable=True
            )
    
    @staticmethod
    def from_exception(
        exception: Exception,
        site: str
    ) -> CrawlerError:
        """Classify error from exception type"""
        
        exc_type = type(exception).__name__
        
        if 'timeout' in str(exception).lower():
            return CrawlerError(
                message=f'Request timeout: {str(exception)}',
                category=ErrorCategory.TIMEOUT,
                severity=ErrorSeverity.ERROR,
                site=site,
                originalError=exception,
                retryable=True
            )
        
        elif 'connection' in str(exception).lower():
            return CrawlerError(
                message=f'Connection error: {str(exception)}',
                category=ErrorCategory.NETWORK_ERROR,
                severity=ErrorSeverity.ERROR,
                site=site,
                originalError=exception,
                retryable=True
            )
        
        elif 'parse' in str(exception).lower() or 'json' in str(exception).lower():
            return CrawlerError(
                message=f'Parsing error: {str(exception)}',
                category=ErrorCategory.PARSING_ERROR,
                severity=ErrorSeverity.WARNING,
                site=site,
                originalError=exception,
                retryable=False
            )
        
        else:
            return CrawlerError(
                message=f'{exc_type}: {str(exception)}',
                category=ErrorCategory.UNKNOWN,
                severity=ErrorSeverity.WARNING,
                site=site,
                originalError=exception,
                retryable=True
            )
```

### Retry Strategy

```python
# middleware/retry_handler.py
import asyncio
import time
from typing import Callable, TypeVar, Optional, Any
import random

T = TypeVar('T')

class RetryConfig:
    """Configuration for retry behavior"""
    
    def __init__(
        self,
        max_retries: int = 2,
        initial_delay: float = 0.5,  # 500ms
        max_delay: float = 30.0,     # 30 seconds
        exponential_base: float = 2.0,
        jitter: bool = True
    ):
        self.max_retries = max_retries
        self.initial_delay = initial_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
    
    def get_delay(self, attempt: int) -> float:
        """Calculate delay for given attempt (0-indexed)"""
        # Exponential backoff: initial_delay * (base ^ attempt)
        delay = self.initial_delay * (self.exponential_base ** attempt)
        delay = min(delay, self.max_delay)
        
        # Add random jitter ±25%
        if self.jitter:
            jitter_amount = delay * 0.25
            delay += random.uniform(-jitter_amount, jitter_amount)
        
        return max(0, delay)  # Ensure non-negative

class RetryHandler:
    """
    Implements intelligent retry logic for crawler operations
    
    - Exponential backoff with jitter
    - Respects 429 rate-limit headers
    - Tracks retry metrics
    """
    
    def __init__(self, config: Optional[RetryConfig] = None):
        self.config = config or RetryConfig()
        self.retry_metrics = {
            'total_retries': 0,
            'successful_retries': 0,
            'failed_retries': 0
        }
    
    async def retry_with_backoff(
        self,
        operation: Callable[..., T],
        *args,
        **kwargs
    ) -> T:
        """
        Execute operation with exponential backoff retry logic
        
        Args:
            operation: Async function to execute
            *args, **kwargs: Arguments to pass to operation
        
        Returns:
            Result from operation
        
        Raises:
            Exception: If all retries exhausted
        """
        last_exception = None
        
        for attempt in range(self.config.max_retries + 1):
            try:
                return await operation(*args, **kwargs)
            
            except Exception as e:
                last_exception = e
                
                # Don't retry on non-retryable errors
                if hasattr(e, 'retryable') and not e.retryable:
                    raise
                
                # Last attempt failed
                if attempt >= self.config.max_retries:
                    self.retry_metrics['failed_retries'] += 1
                    raise
                
                # Calculate backoff
                delay = self.config.get_delay(attempt)
                
                # Check for rate-limit headers
                if hasattr(e, 'headers'):
                    retry_after = e.headers.get('Retry-After')
                    if retry_after:
                        try:
                            delay = max(delay, float(retry_after))
                        except:
                            pass
                
                self.retry_metrics['total_retries'] += 1
                
                # Sleep before retry
                await asyncio.sleep(delay)
        
        # Exhausted all retries
        self.retry_metrics['failed_retries'] += 1
        raise last_exception
    
    def get_metrics(self) -> dict:
        """Get retry metrics"""
        return {
            **self.retry_metrics,
            'success_rate': (
                self.retry_metrics['successful_retries'] /
                max(1, self.retry_metrics['total_retries'])
            ) if self.retry_metrics['total_retries'] > 0 else 0
        }

class CircuitBreaker:
    """
    Implements circuit breaker pattern for failing sites
    
    Prevents hammer on failing job boards:
    - CLOSED: Normal operation
    - OPEN: Reject requests after failure threshold
    - HALF_OPEN: Test if service recovered
    """
    
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 300  # 5 minutes
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures: dict[str, list[float]] = {}  # site -> timestamps
        self.state: dict[str, str] = {}  # site -> CLOSED/OPEN/HALF_OPEN
    
    async def execute(
        self,
        site: str,
        operation: Callable[..., T],
        *args,
        **kwargs
    ) -> T:
        """Execute operation with circuit breaker protection"""
        
        # Check state
        state = self.state.get(site, 'CLOSED')
        
        if state == 'OPEN':
            # Check recovery timeout
            failures = self.failures.get(site, [])
            if time.time() - failures[-1] > self.recovery_timeout:
                self.state[site] = 'HALF_OPEN'
            else:
                raise Exception(f'Circuit breaker OPEN for {site}')
        
        try:
            result = await operation(*args, **kwargs)
            # Success - reset failures
            self.failures[site] = []
            self.state[site] = 'CLOSED'
            return result
        
        except Exception as e:
            # Record failure
            if site not in self.failures:
                self.failures[site] = []
            
            self.failures[site].append(time.time())
            
            # Check threshold
            if len(self.failures[site]) >= self.failure_threshold:
                self.state[site] = 'OPEN'
            
            raise
```

---

## 5. INTEGRATION POINTS (REST API + BullMQ)

### REST API Design

```python
# server.py - Flask HTTP Server
from flask import Flask, request, jsonify
from typing import Dict, Any, List
import asyncio
from core.orchestrator import CrawlerOrchestrator
from models.request import JobRequest
from models.response import JobResponse
from middleware.error_handler import ErrorHandler

app = Flask(__name__)
orchestrator = CrawlerOrchestrator()

# Store async job results temporarily
async_results: Dict[str, Dict[str, Any]] = {}

@app.route('/crawler/scrape', methods=['POST'])
async def scrape():
    """
    POST /crawler/scrape
    
    Request:
    {
      "searchId": "search123",
      "sites": ["linkedin.com", "indeed.com"],
      "keywords": "Remote Python Developer",
      "config": {
        "timeout": 15000,
        "maxRetries": 2,
        "userAgent": "Mozilla/5.0..."
      }
    }
    
    Response:
    {
      "status": "success|partial|timeout|error",
      "results": [
        {
          "source": "linkedin.com",
          "jobs": [...],
          "errors": [],
          "timestamp": "2026-05-29T19:12:30Z",
          "metrics": {
            "extraction_time_ms": 12500,
            "jobs_extracted": 18
          }
        }
      ],
      "aggregated": {
        "total_jobs": 45,
        "total_errors": 1,
        "processing_time_ms": 31000
      }
    }
    """
    try:
        # Validate request
        req_data = request.get_json()
        job_request = JobRequest(**req_data)
        
        # Execute crawling (with timeout)
        results = await orchestrator.scrape_with_timeout(
            searchId=job_request.searchId,
            sites=job_request.sites,
            keywords=job_request.keywords,
            config=job_request.config,
            timeout=30  # Global 30 second timeout
        )
        
        # Aggregate results
        aggregated = {
            'total_jobs': sum(r.get('jobs_count', 0) for r in results),
            'total_errors': sum(len(r.get('errors', [])) for r in results),
            'processing_time_ms': sum(r.get('metrics', {}).get('extraction_time_ms', 0) for r in results)
        }
        
        # Determine status
        if aggregated['total_errors'] > 0 and aggregated['total_jobs'] == 0:
            status = 'error'
        elif aggregated['total_errors'] > 0:
            status = 'partial'
        else:
            status = 'success'
        
        return jsonify({
            'status': status,
            'results': results,
            'aggregated': aggregated,
            'timestamp': datetime.utcnow().isoformat()
        }), 200 if status == 'success' else 206
    
    except asyncio.TimeoutError:
        return jsonify({
            'status': 'timeout',
            'message': 'Crawling timeout (>30 seconds)',
            'timestamp': datetime.utcnow().isoformat()
        }), 408
    
    except Exception as e:
        error = ErrorHandler.from_exception(e, 'api')
        return jsonify({
            'status': 'error',
            'error': error.to_dict(),
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@app.route('/crawler/scrape/async', methods=['POST'])
def scrape_async():
    """
    POST /crawler/scrape/async
    
    For long-running operations, return immediately with request ID
    
    Response:
    {
      "requestId": "req_abc123",
      "status": "queued",
      "statusUrl": "/crawler/status/req_abc123"
    }
    """
    try:
        req_data = request.get_json()
        job_request = JobRequest(**req_data)
        
        # Queue async job
        request_id = orchestrator.queue_async_scrape(
            searchId=job_request.searchId,
            sites=job_request.sites,
            keywords=job_request.keywords,
            config=job_request.config
        )
        
        return jsonify({
            'requestId': request_id,
            'status': 'queued',
            'statusUrl': f'/crawler/status/{request_id}'
        }), 202
    
    except Exception as e:
        error = ErrorHandler.from_exception(e, 'api')
        return jsonify({
            'status': 'error',
            'error': error.to_dict()
        }), 500

@app.route('/crawler/status/<request_id>', methods=['GET'])
def get_status(request_id: str):
    """
    GET /crawler/status/{request_id}
    
    Get status of async crawling request
    
    Response:
    {
      "requestId": "req_abc123",
      "status": "processing|complete|failed",
      "progress": 50,
      "results": {...},  # When complete
      "error": {...}     # When failed
    }
    """
    result = async_results.get(request_id)
    
    if not result:
        return jsonify({
            'error': 'Request not found',
            'requestId': request_id
        }), 404
    
    return jsonify(result), 200

@app.route('/crawler/health', methods=['GET'])
def health():
    """
    GET /crawler/health
    
    Health check endpoint
    """
    return jsonify({
        'status': 'healthy',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat(),
        'extractors': [e.name for e in orchestrator.get_extractors()]
    }), 200

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'error': 'Internal server error',
        'message': str(error)
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=False)
```

### BullMQ Integration (API → Crawler)

```typescript
// packages/api/src/crawler/crawler-client.ts

import axios, { AxiosError } from 'axios'
import { addEvent } from '../events/queue.js'

interface CrawlerRequest {
  searchId: string
  sites: string[]
  keywords: string
  config?: {
    timeout?: number
    maxRetries?: number
    userAgent?: string
  }
}

interface CrawlerResult {
  source: string
  jobs: any[]
  errors: Array<{ message: string; site?: string }>
  timestamp: string
  metrics?: {
    extraction_time_ms: number
    jobs_extracted: number
  }
}

interface CrawlerResponse {
  status: 'success' | 'partial' | 'timeout' | 'error'
  results: CrawlerResult[]
  aggregated: {
    total_jobs: number
    total_errors: number
    processing_time_ms: number
  }
  timestamp: string
}

class CrawlerClient {
  private crawlerUrl: string
  
  constructor(crawlerUrl: string = process.env.CRAWLER_URL || 'http://localhost:8000') {
    this.crawlerUrl = crawlerUrl
  }
  
  /**
   * Call crawler synchronously (blocks until complete or timeout)
   * Used for direct API requests
   */
  async scrapeJobs(request: CrawlerRequest): Promise<CrawlerResponse> {
    try {
      const response = await axios.post<CrawlerResponse>(
        `${this.crawlerUrl}/crawler/scrape`,
        request,
        {
          timeout: 35000  // 35 seconds (crawler has 30s timeout)
        }
      )
      
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Crawler service unavailable')
        } else if (error.response?.status === 408) {
          throw new Error('Crawler request timeout')
        }
      }
      throw error
    }
  }
  
  /**
   * Queue crawler job asynchronously via BullMQ
   * Returns immediately, processes in background
   */
  async queueCrawlJob(request: CrawlerRequest): Promise<string> {
    const jobId = await addEvent('crawl_requested', request)
    return jobId
  }
  
  /**
   * Get status of async crawl job
   */
  async getJobStatus(jobId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.crawlerUrl}/crawler/status/${jobId}`,
        { timeout: 5000 }
      )
      return response.data
    } catch (error) {
      throw error
    }
  }
  
  /**
   * Health check crawler service
   */
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${this.crawlerUrl}/crawler/health`, {
        timeout: 5000
      })
      return true
    } catch {
      return false
    }
  }
}

export default CrawlerClient
```

### BullMQ Event Handler Integration

```typescript
// packages/api/src/events/handlers.ts - Crawler handler

import { CrawlerClient } from '../crawler/crawler-client.js'
import { JobModel, SearchSessionModel } from '../db/models.js'
import { addEvent } from './queue.js'

const crawlerClient = new CrawlerClient()

export const crawlJobsHandler = async (
  data: {
    searchId: string
    sites: string[]
    keywords: string
    config?: any
  },
  sseManager: any
) => {
  try {
    console.log(`🕷️  CRAWLER: Starting crawl for search ${data.searchId}`)
    console.log(`   Sites: ${data.sites.join(', ')}`)
    console.log(`   Keywords: ${data.keywords}`)
    
    // Update search session status
    await SearchSessionModel.findByIdAndUpdate(
      data.searchId,
      { status: 'crawling' }
    )
    
    // Call crawler service
    const result = await crawlerClient.scrapeJobs({
      searchId: data.searchId,
      sites: data.sites,
      keywords: data.keywords,
      config: data.config || { timeout: 15000, maxRetries: 2 }
    })
    
    console.log(`✅ CRAWLER: Crawl complete`)
    console.log(`   Status: ${result.status}`)
    console.log(`   Total jobs: ${result.aggregated.total_jobs}`)
    console.log(`   Errors: ${result.aggregated.total_errors}`)
    console.log(`   Time: ${result.aggregated.processing_time_ms}ms`)
    
    // Store jobs in database
    const jobsToStore = result.results.flatMap(r => 
      r.jobs.map(job => ({
        ...job,
        searchSessionId: data.searchId,
        discoveredAt: new Date(),
        source: r.source
      }))
    )
    
    if (jobsToStore.length > 0) {
      await JobModel.insertMany(jobsToStore)
      console.log(`💾 Stored ${jobsToStore.length} jobs in database`)
    }
    
    // Emit next event for ranking
    await addEvent('jobs_crawled', {
      searchId: data.searchId,
      jobCount: jobsToStore.length,
      errors: result.results.flatMap(r => r.errors)
    })
    
    // Update SSE clients
    if (sseManager) {
      sseManager.broadcast({
        type: 'jobs_crawled',
        searchId: data.searchId,
        jobCount: jobsToStore.length,
        totalTime: result.aggregated.processing_time_ms
      })
    }
    
  } catch (error) {
    console.error(`❌ CRAWLER ERROR: ${error.message}`)
    
    // Update search session with error
    await SearchSessionModel.findByIdAndUpdate(
      data.searchId,
      {
        status: 'failed',
        error: error.message
      }
    )
    
    // Emit error event
    if (sseManager) {
      sseManager.broadcast({
        type: 'crawl_failed',
        searchId: data.searchId,
        error: error.message
      })
    }
  }
}
```

---

## 6. SCALABILITY CONSIDERATIONS

### Performance Optimization Strategies

```
┌──────────────────────────────────────────────────────────────┐
│              Scalability Architecture                         │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Load Balancer (Nginx/HAProxy)                           │  │
│  │ - Round robin across crawler instances                  │  │
│  │ - Connection pooling                                    │  │
│  └─────────────────────────────────────────────────────────┘  │
│              │                                                  │
│              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Crawler Instance Pool                                   │  │
│  │ ┌─────────┐  ┌─────────┐  ┌─────────┐                  │  │
│  │ │Crawler 1│  │Crawler 2│  │Crawler N│                  │  │
│  │ │ Port    │  │ Port    │  │ Port    │                  │  │
│  │ │ 8000    │  │ 8001    │  │ 8000+N  │                  │  │
│  │ └─────────┘  └─────────┘  └─────────┘                  │  │
│  └─────────────────────────────────────────────────────────┘  │
│              │                                                  │
│              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Shared Services                                         │  │
│  │ ┌──────────────────┐  ┌──────────────────┐             │  │
│  │ │  Redis Cache     │  │  PostgreSQL      │             │  │
│  │ │ Deduplication    │  │ Job History      │             │  │
│  │ │ Session Cache    │  │ Metrics Store    │             │  │
│  │ └──────────────────┘  └──────────────────┘             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└──────────────────────────────────────────────────────────────┘
```

### Concurrent Scraping Pattern

```python
# core/orchestrator.py - Concurrent site scraping

class CrawlerOrchestrator:
    """
    Main orchestrator for concurrent job scraping
    
    Performance strategy:
    - Run extractors concurrently with asyncio
    - Implement per-site timeouts
    - Partial result aggregation
    - Graceful degradation on failures
    """
    
    def __init__(self, max_concurrent: int = 5):
        self.max_concurrent = max_concurrent  # Max concurrent spiders
        self.extractors = self._initialize_extractors()
    
    async def scrape_with_timeout(
        self,
        searchId: str,
        sites: List[str],
        keywords: str,
        config: Optional[dict] = None,
        timeout: int = 30
    ) -> List[dict]:
        """
        Scrape multiple sites concurrently with global timeout
        
        Performance target: 3 sites in 10-15 seconds
        """
        config = config or {}
        results = []
        errors = []
        
        start_time = time.time()
        
        try:
            # Create semaphore to limit concurrency
            semaphore = asyncio.Semaphore(self.max_concurrent)
            
            # Create tasks for each site
            tasks = [
                self._scrape_site_with_semaphore(
                    semaphore,
                    site,
                    keywords,
                    config,
                    searchId
                )
                for site in sites
            ]
            
            # Wait for all tasks or timeout
            completed, pending = await asyncio.wait(
                tasks,
                timeout=timeout,
                return_when=asyncio.FIRST_EXCEPTION
            )
            
            # Collect results from completed tasks
            for task in completed:
                try:
                    result = await task
                    results.append(result)
                except Exception as e:
                    errors.append({
                        'message': str(e),
                        'severity': 'error'
                    })
            
            # Cancel pending tasks (timeout exceeded)
            for task in pending:
                task.cancel()
            
            elapsed = time.time() - start_time
            
            return {
                'results': results,
                'errors': errors,
                'elapsed_ms': int(elapsed * 1000),
                'timeout_exceeded': len(pending) > 0
            }
        
        except Exception as e:
            raise
    
    async def _scrape_site_with_semaphore(
        self,
        semaphore: asyncio.Semaphore,
        site: str,
        keywords: str,
        config: dict,
        searchId: str
    ) -> dict:
        """Scrape single site with semaphore to limit concurrency"""
        async with semaphore:
            return await self._scrape_site(site, keywords, config, searchId)
    
    async def _scrape_site(
        self,
        site: str,
        keywords: str,
        config: dict,
        searchId: str
    ) -> dict:
        """Scrape a single site"""
        site_start = time.time()
        
        try:
            # Find matching extractor
            extractor = self._find_extractor(site)
            if not extractor:
                return {
                    'source': site,
                    'jobs': [],
                    'errors': [{'message': f'No extractor for {site}', 'site': site}],
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # Extract jobs with per-site timeout
            per_site_timeout = config.get('timeout', 15000) // 1000
            
            try:
                jobs, errors = await asyncio.wait_for(
                    extractor.extract(f'https://{site}/jobs', keywords),
                    timeout=per_site_timeout
                )
            except asyncio.TimeoutError:
                jobs = []
                errors = [{
                    'message': f'Extraction timeout after {per_site_timeout}s',
                    'site': site,
                    'severity': 'error'
                }]
            
            # Deduplication
            unique_jobs, dups = await self.deduplicator.deduplicate_batch(
                jobs,
                searchId
            )
            
            elapsed = time.time() - site_start
            
            return {
                'source': site,
                'jobs': [j.to_dict() for j in unique_jobs],
                'errors': errors,
                'timestamp': datetime.utcnow().isoformat(),
                'metrics': {
                    'extraction_time_ms': int(elapsed * 1000),
                    'jobs_extracted': len(unique_jobs),
                    'duplicates_removed': dups
                }
            }
        
        except Exception as e:
            return {
                'source': site,
                'jobs': [],
                'errors': [{
                    'message': f'Scrape error: {str(e)}',
                    'site': site,
                    'severity': 'error'
                }],
                'timestamp': datetime.utcnow().isoformat(),
                'metrics': {
                    'extraction_time_ms': int((time.time() - site_start) * 1000)
                }
            }
```

### Caching Strategy

```python
# core/cache.py - Redis-backed caching layer

class CrawlerCache:
    """
    Multi-layered caching strategy:
    1. URL-based deduplication (24-hour TTL)
    2. Site metadata caching (7-day TTL)
    3. Job listings cache (1-hour TTL, per search)
    """
    
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
    
    async def get_cached_jobs(
        self,
        searchId: str,
        site: str
    ) -> Optional[List[dict]]:
        """
        Get cached job listings for a search/site combo
        
        Cache key: search:{searchId}:site:{site}
        TTL: 1 hour
        """
        key = f"search:{searchId}:site:{site}"
        cached = await self.redis.get(key)
        return json.loads(cached) if cached else None
    
    async def cache_jobs(
        self,
        searchId: str,
        site: str,
        jobs: List[dict],
        ttl: int = 3600
    ) -> None:
        """Cache job listings"""
        key = f"search:{searchId}:site:{site}"
        await self.redis.setex(
            key,
            ttl,
            json.dumps(jobs)
        )
    
    async def get_site_metadata(self, site: str) -> Optional[dict]:
        """
        Get cached site metadata (selectors, timeout, etc.)
        
        Cache key: site_meta:{site}
        TTL: 7 days
        """
        key = f"site_meta:{site}"
        cached = await self.redis.get(key)
        return json.loads(cached) if cached else None
    
    async def cache_site_metadata(
        self,
        site: str,
        metadata: dict,
        ttl: int = 604800  # 7 days
    ) -> None:
        """Cache site metadata for quick access"""
        key = f"site_meta:{site}"
        await self.redis.setex(
            key,
            ttl,
            json.dumps(metadata)
        )
```

---

## 7. DEPLOYMENT ARCHITECTURE

### Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Existing services
  mongodb:
    image: mongo:8.3
    container_name: job-search-mongodb
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    networks:
      - job-search-net
    environment:
      MONGO_INITDB_DATABASE: job_search

  redis:
    image: redis:8.6
    container_name: job-search-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - job-search-net
    command: redis-server --appendonly yes

  # API Server (Node.js)
  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    container_name: job-search-api
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      MONGODB_URI: mongodb://mongodb:27017/job_search
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      CLAUDE_API_KEY: ${CLAUDE_API_KEY}
      CRAWLER_URL: http://crawler:8000
    depends_on:
      - mongodb
      - redis
    networks:
      - job-search-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # Crawler Service (Python)
  crawler:
    build:
      context: ./crawler
      dockerfile: Dockerfile
    container_name: job-search-crawler
    ports:
      - "8000:8000"
    environment:
      REDIS_URL: redis://redis:6379
      API_URL: http://api:3000
      PYTHONUNBUFFERED: 1
      LOG_LEVEL: INFO
    depends_on:
      - redis
      - api
    networks:
      - job-search-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/crawler/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - ./crawler:/app
    # Deploy multiple instances via scaling
    deploy:
      replicas: 2

  # Crawler Load Balancer (Nginx)
  crawler-lb:
    image: nginx:latest
    container_name: job-search-crawler-lb
    ports:
      - "8080:80"
    volumes:
      - ./crawler-nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - job-search-net
    depends_on:
      - crawler

volumes:
  mongo_data:
  redis_data:

networks:
  job-search-net:
    driver: bridge
```

### Kubernetes Deployment

```yaml
# k8s/crawler-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-search-crawler
  namespace: default
spec:
  replicas: 3  # Scale to 3 instances
  selector:
    matchLabels:
      app: job-search-crawler
  template:
    metadata:
      labels:
        app: job-search-crawler
    spec:
      containers:
      - name: crawler
        image: job-search/crawler:1.0.0
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 8000
        env:
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: crawler-config
              key: redis-url
        - name: API_URL
          valueFrom:
            configMapKeyRef:
              name: crawler-config
              key: api-url
        - name: LOG_LEVEL
          value: "INFO"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /crawler/health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /crawler/health
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: job-search-crawler-svc
spec:
  selector:
    app: job-search-crawler
  ports:
  - protocol: TCP
    port: 8000
    targetPort: 8000
  type: LoadBalancer

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: crawler-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: job-search-crawler
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 8. COMPONENT INTERACTION DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                     API REQUEST FLOW                                 │
│                                                                       │
│  Frontend (React)                                                    │
│      │                                                               │
│      │ "Search for Python jobs"                                      │
│      ▼                                                               │
│  ┌──────────────────────┐                                            │
│  │  API Server          │                                            │
│  │  POST /api/searches  │                                            │
│  └──────────┬───────────┘                                            │
│             │                                                         │
│             ▼                                                         │
│  ┌──────────────────────┐                                            │
│  │ Create SearchSession │                                            │
│  │ in MongoDB           │                                            │
│  └──────────┬───────────┘                                            │
│             │                                                         │
│             ▼                                                         │
│  ┌──────────────────────┐                                            │
│  │ Emit Event:          │                                            │
│  │ search_started       │                                            │
│  │ to BullMQ            │                                            │
│  └──────────┬───────────┘                                            │
│             │                                                         │
└─────────────┼─────────────────────────────────────────────────────────┘
              │
              │ Event Handler (Event-Driven)
              │
┌─────────────▼─────────────────────────────────────────────────────────┐
│                     EVENT HANDLER FLOW                                 │
│                                                                        │
│  ┌──────────────────────────────┐                                     │
│  │ Handler: search_started       │                                    │
│  │ - Call Claude for refining    │                                    │
│  │ - Determine target sites      │                                    │
│  └──────────────┬────────────────┘                                    │
│                 │                                                      │
│                 ▼                                                      │
│  ┌──────────────────────────────┐                                     │
│  │ Emit Event:                  │                                     │
│  │ claude_analysis_complete     │                                     │
│  │ { sites: ['indeed.com', ...] │                                     │
│  └──────────────┬────────────────┘                                    │
│                 │                                                      │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Handler: claude_analysis_complete                            │    │
│  │ - Call Crawler Service                                       │    │
│  │   POST http://crawler:8000/crawler/scrape                   │    │
│  │   {searchId, sites, keywords, config}                        │    │
│  └──────────────┬───────────────────────────────────────────────┘    │
│                 │                                                      │
└─────────────────┼──────────────────────────────────────────────────────┘
                  │
                  │ HTTP Request (Async Operation)
                  │
┌─────────────────▼──────────────────────────────────────────────────────┐
│                     CRAWLER SERVICE FLOW                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │ Flask: POST /crawler/scrape                                  │     │
│  │ Receives: {searchId, sites, keywords, config}                │     │
│  └──────────────┬───────────────────────────────────────────────┘     │
│                 │                                                      │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │ Orchestrator: Concurrent Extraction                           │     │
│  │                                                                │     │
│  │  ┌─────────────────────┐  ┌─────────────────────┐            │     │
│  │  │LinkedInExtractor    │  │IndeedExtractor      │  ...       │     │
│  │  │(Selenium)           │  │(aiohttp + BS4)      │            │     │
│  │  │Timeout: 15s         │  │Timeout: 15s         │            │     │
│  │  │10-15s per req       │  │10-15s per req       │            │     │
│  │  │                     │  │                     │            │     │
│  │  │asyncio.gather()     │  │asyncio.gather()     │            │     │
│  │  └──────────┬──────────┘  └──────────┬──────────┘            │     │
│  │             │                        │                      │     │
│  │             ▼                        ▼                      │     │
│  │  ┌────────────────────────────────────────────────────┐     │     │
│  │  │ Job Validator & Deduplicator                      │     │     │
│  │  │ - Validate required fields                        │     │     │
│  │  │ - Check URL format                                │     │     │
│  │  │ - Remove duplicates (Redis cache)                │     │     │
│  │  │ - Quality scoring                                │     │     │
│  │  └──────────────┬─────────────────────────────────────┘     │     │
│  │                 │                                            │     │
│  │                 ▼                                            │     │
│  │  ┌────────────────────────────────────────────────────┐     │     │
│  │  │ Result Aggregator                                 │     │     │
│  │  │ {                                                  │     │     │
│  │  │   results: [                                       │     │     │
│  │  │     {source: "indeed.com", jobs: [...], errors}  │     │     │
│  │  │     {source: "linkedin.com", jobs: [...], ...}   │     │     │
│  │  │   ]                                                │     │     │
│  │  │   aggregated: {total_jobs: 45, errors: 1}         │     │     │
│  │  │ }                                                  │     │     │
│  │  └──────────────┬─────────────────────────────────────┘     │     │
│  │                 │                                            │     │
│  │                 ▼                                            │     │
│  │  ┌────────────────────────────────────────────────────┐     │     │
│  │  │ HTTP Response (200 OK)                            │     │     │
│  │  │ Total Time: ~15-25 seconds (3 sites)              │     │     │
│  │  └──────────────┬─────────────────────────────────────┘     │     │
│  └────────────────────────────────────────────────────────────┘     │
│                 │                                                    │
└─────────────────┼────────────────────────────────────────────────────┘
                  │
                  │ HTTP Response (Back to API)
                  │
┌─────────────────▼────────────────────────────────────────────────────┐
│                     API PROCESSING FLOW                               │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Handler receives crawler results                             │   │
│  │ - Store jobs in MongoDB                                      │   │
│  │ - Emit jobs_crawled event                                    │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │                                                    │
│                 ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Handler: jobs_crawled                                        │   │
│  │ - Fetch jobs from DB                                         │   │
│  │ - Call Claude for ranking/evaluation                         │   │
│  │ - Emit jobs_ranked event                                     │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │                                                    │
│                 ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Frontend polls GET /api/searches/{id}/jobs                   │   │
│  │ Returns: Ranked jobs with match scores                       │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │                                                    │
│                 ▼                                                    │
│  Frontend displays ranked results to user                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. API DESIGN (Request/Response Schemas)

### Request Schema

```json
POST /crawler/scrape
Content-Type: application/json

{
  "searchId": "6a19e51ee82d696124d41c6d",
  "sites": ["linkedin.com", "indeed.com", "glassdoor.com"],
  "keywords": "Remote Python Developer",
  "config": {
    "timeout": 15000,
    "maxRetries": 2,
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  }
}
```

### Response Schema (Success)

```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "success",
  "results": [
    {
      "source": "linkedin.com",
      "jobs": [
        {
          "title": "Senior Python Developer",
          "company": "TechCorp Inc.",
          "description": "We are seeking an experienced Python developer with 5+ years experience...",
          "url": "https://linkedin.com/jobs/12345",
          "location": "Remote",
          "salary": "$120,000 - $160,000",
          "sourceUrl": "https://linkedin.com"
        }
      ],
      "errors": [],
      "timestamp": "2026-05-29T19:12:30Z",
      "metrics": {
        "extraction_time_ms": 12500,
        "jobs_extracted": 18,
        "duplicates_removed": 2
      }
    },
    {
      "source": "indeed.com",
      "jobs": [
        {
          "title": "Python Backend Engineer",
          "company": "StartupXYZ",
          "description": "Build scalable Python applications in a remote-first environment...",
          "url": "https://indeed.com/jobs/67890",
          "location": "Remote",
          "salary": "$130,000 - $170,000",
          "sourceUrl": "https://indeed.com"
        }
      ],
      "errors": [],
      "timestamp": "2026-05-29T19:12:35Z",
      "metrics": {
        "extraction_time_ms": 14200,
        "jobs_extracted": 22,
        "duplicates_removed": 3
      }
    }
  ],
  "aggregated": {
    "total_jobs": 40,
    "total_errors": 0,
    "processing_time_ms": 14200
  },
  "timestamp": "2026-05-29T19:12:35Z"
}
```

### Response Schema (Partial Success)

```json
HTTP/1.1 206 Partial Content
Content-Type: application/json

{
  "status": "partial",
  "results": [
    {
      "source": "linkedin.com",
      "jobs": [...],
      "errors": [],
      "timestamp": "2026-05-29T19:12:30Z",
      "metrics": {
        "extraction_time_ms": 12500,
        "jobs_extracted": 18
      }
    },
    {
      "source": "glassdoor.com",
      "jobs": [],
      "errors": [
        {
          "message": "Connection timeout after 15 seconds",
          "severity": "error",
          "retryable": true,
          "category": "timeout"
        }
      ],
      "timestamp": "2026-05-29T19:12:30Z",
      "metrics": {
        "extraction_time_ms": 15000
      }
    }
  ],
  "aggregated": {
    "total_jobs": 18,
    "total_errors": 1,
    "processing_time_ms": 15000
  },
  "timestamp": "2026-05-29T19:12:35Z"
}
```

### Response Schema (Timeout)

```json
HTTP/1.1 408 Request Timeout
Content-Type: application/json

{
  "status": "timeout",
  "message": "Crawling timeout (>30 seconds)",
  "partialResults": [
    {
      "source": "linkedin.com",
      "jobs": [...],
      "metrics": {
        "extraction_time_ms": 12500,
        "jobs_extracted": 18
      }
    }
  ],
  "timestamp": "2026-05-29T19:12:35Z"
}
```

---

## 10. DATABASE MODELS

### Crawler State Tracking (MongoDB)

```javascript
// CrawlerJob Collection - Tracks async crawl requests
{
  _id: ObjectId,
  searchId: String,                      // Link to SearchSession
  requestId: String,                     // Unique async request ID
  status: "queued" | "processing" | "completed" | "failed",
  sites: [String],
  keywords: String,
  config: {
    timeout: Number,
    maxRetries: Number,
    userAgent: String
  },
  results: [{
    source: String,
    jobCount: Number,
    errorCount: Number,
    extractionTimeMs: Number
  }],
  metrics: {
    totalTimeMs: Number,
    jobsExtracted: Number,
    duplicatesRemoved: Number,
    startTime: Date,
    endTime: Date
  },
  errors: [{
    message: String,
    category: String,
    severity: String,
    site: String,
    timestamp: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### Job Deduplication Cache (Redis)

```
Key: job_url:{url_hash}
Value: {url}
TTL: 86400 (24 hours)

Key: search:{searchId}:site:{site}
Value: [job1, job2, ...]
TTL: 3600 (1 hour)

Key: site_meta:{site}
Value: {selectors, timeout, last_updated}
TTL: 604800 (7 days)
```

---

## IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1-2)
- [ ] Set up Scrapy project structure
- [ ] Implement BaseExtractor and GenericExtractor
- [ ] Create Flask HTTP server with `/crawler/scrape` endpoint
- [ ] Implement basic job validation
- [ ] Write unit tests for validators

**Success Criteria:**
- Flask server responds to health checks
- Generic extractor can scrape basic HTML job boards
- Job validation filters invalid entries

### Phase 2: Site-Specific Extractors (Week 2-3)
- [ ] Implement IndeedExtractor (aiohttp + BeautifulSoup)
- [ ] Implement LinkedInExtractor (Selenium)
- [ ] Add site detection logic in orchestrator
- [ ] Implement extractor registry pattern

**Success Criteria:**
- Indeed extractor returns 15+ valid jobs within 15 seconds
- LinkedIn extractor handles JavaScript rendering
- 3-site scraping completes in <20 seconds

### Phase 3: Resilience & Optimization (Week 3-4)
- [ ] Implement job deduplication with Redis
- [ ] Add retry logic with exponential backoff
- [ ] Implement circuit breaker pattern
- [ ] Add comprehensive error handling
- [ ] Implement rate limiting middleware

**Success Criteria:**
- Duplicate detection works across requests
- Failed sites don't impact successful ones
- Partial results returned on timeout
- Graceful degradation on errors

### Phase 4: Integration (Week 4-5)
- [ ] Connect to API via REST + BullMQ
- [ ] Implement event handlers in API
- [ ] Add crawler webhook endpoint in API
- [ ] Create TypeScript client library
- [ ] End-to-end integration tests

**Success Criteria:**
- Search request triggers crawler via event
- Crawler returns results to API
- Results stored in MongoDB
- Frontend displays ranked jobs

### Phase 5: Production Readiness (Week 5-6)
- [ ] Docker containerization
- [ ] Kubernetes deployment configs
- [ ] Load balancer setup (Nginx)
- [ ] Comprehensive logging & monitoring
- [ ] Performance benchmarking
- [ ] Security hardening (input validation, rate limits)
- [ ] Documentation & runbooks

**Success Criteria:**
- Service runs in containers
- Horizontal scaling possible
- Monitoring/alerting in place
- <2% error rate on production traffic

---

## KEY ARCHITECTURAL DECISIONS

### ADR 1: Scrapy vs. Custom HTTP Client

**Context:** Choose between framework (Scrapy) vs. lightweight (requests/aiohttp)

**Decision:** Hybrid approach
- Use **aiohttp + BeautifulSoup** for simple, fast extraction (Indeed, generic)
- Use **Selenium** for JavaScript-heavy sites (LinkedIn)
- Use **Scrapy only for specific complex scrapers** (future)

**Rationale:**
- Faster startup time for lightweight sites
- Simpler deployment (fewer dependencies)
- Selenium only when needed (JS rendering)
- Preserves option to use Scrapy for scale-out

**Consequences:**
- Must manage multiple extraction libraries
- Better performance for most cases
- Clear separation of concerns

### ADR 2: Synchronous vs. Asynchronous API

**Context:** Should crawler be sync (blocking) or async (fire-and-forget)?

**Decision:** Provide both:
1. **Synchronous** (`POST /crawler/scrape`) - Direct HTTP, blocks, returns results
2. **Asynchronous** (`POST /crawler/scrape/async`) - Returns request ID, polls status

**Rationale:**
- Synchronous for quick <20 second scrapes (common case)
- Asynchronous for long operations (fallback)
- Matches BullMQ event-driven architecture
- Allows frontend to poll vs. block

**Consequences:**
- API must support both patterns
- Client must handle two response types
- More flexible but slightly more complex

### ADR 3: Single vs. Multiple Extractor Instances

**Context:** One flexible extractor vs. many site-specific ones?

**Decision:** Plugin pattern with site-specific + generic fallback

**Rationale:**
- Site-specific extractors optimize for each site's structure
- Generic fallback handles unknown sites
- Easy to add new extractors without changing core
- Self-documenting code

**Consequences:**
- More code per new site, but clear boundaries
- Better maintainability than massive switch statements
- Easier to test individual extractors

### ADR 4: Deduplication Strategy

**Context:** How to prevent duplicate jobs across crawl batches?

**Decision:** Multi-layer deduplication
1. Within-batch: URL set
2. Redis cache: URL hash (24-hour TTL)
3. Database: URL unique index

**Rationale:**
- Within-batch is fast (in-memory)
- Redis cache prevents duplicates across crawls
- Database unique index as final safety net
- Good performance/correctness balance

**Consequences:**
- Requires Redis infrastructure
- 24-hour duplication window (acceptable)
- Slightly higher latency (Redis lookups)

---

## SECURITY CONSIDERATIONS

1. **Input Validation:** Validate all crawler request parameters
2. **Rate Limiting:** Per-site rate limits to avoid blocking
3. **User-Agent Rotation:** Use realistic user agents (don't appear as bot)
4. **Timeout Protection:** Prevent hanging requests with timeouts
5. **Error Handling:** Never expose internal URLs/paths in errors
6. **Logging:** Sanitize sensitive data in logs
7. **Network Security:** Use VPC/firewalls for Redis/MongoDB
8. **HTTPS Only:** All API communication over HTTPS in production

---

## MONITORING & OBSERVABILITY

```python
# Metrics to track:
- jobs_extracted_total (counter per site)
- extraction_time_ms (histogram)
- error_rate_percent (gauge per site)
- cache_hit_rate (gauge)
- concurrent_requests (gauge)
- queue_depth (gauge - BullMQ)

# Alerts:
- High error rate (>10%)
- Long extraction times (>20s consistently)
- Circuit breaker open for site
- Redis connection issues
- Crawler service unavailable
```

---

This comprehensive architecture design provides your implementation team with:

✅ **Clear component responsibilities** - Each module has single purpose
✅ **Production-ready patterns** - Retry logic, error handling, caching
✅ **Extensible design** - Easy to add new site extractors
✅ **Performance optimized** - Concurrent scraping, timeouts, caching
✅ **Scalable infrastructure** - Horizontal scaling via Docker/Kubernetes
✅ **Comprehensive documentation** - Code is self-documenting with examples
✅ **Integration roadmap** - Phased implementation plan with success criteria

The implementation team can now build with confidence, knowing exactly how each component connects and what trade-offs have been made.
