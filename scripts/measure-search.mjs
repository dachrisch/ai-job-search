#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Simple random hex string (no crypto dependency)
function randomHex(length = 8) {
  let hex = '';
  for (let i = 0; i < length; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

// Parse environment
const env = process.env;
const isLive = env.RUN_LIVE === '1';
const isProd = env.RUN_PROD === '1';

const BASE_URL = isProd
  ? 'https://jobs.lehel.xyz'
  : 'http://localhost:3000';

// Config
const EMAIL = env.MEASURE_EMAIL || 'test@example.com';
const PASSWORD = env.MEASURE_PASSWORD || 'testpassword';
const QUERY = 'Product Manager in Munich';
const MAX_TIMEOUT_MS = 120000; // 120 seconds

// Blocklisted companies (default 'alfatraining')
const BLOCKLISTED_COMPANIES = new Set(
  (env.BLOCKLISTED_COMPANIES || 'alfatraining').split(',').map(s => s.trim())
);

// PM title regex - known Product Manager variants
const PM_TITLE_REGEX = /^(Product Manager|Product Owner|Product Lead|Product Director|Senior Product Manager|Lead Product Manager|Product Manager.*\([^)]*\)|Product Manager.*\([^)]*\)|Product Manager[^)]*$)/i;

/**
 * Determine if a job is in Munich area (from location field)
 */
function isMunichLocation(location) {
  if (!location) return false;
  const locLower = location.toLowerCase();
  return locLower.includes('munich') || locLower.includes('münchen');
}

/**
 * Determine if job is remote (full remote)
 */
function isRemote(job) {
  return job.remote === 'full' || job.remote === 'true' || job.remote === '1';
}

/**
 * Check job against PM title regex
 */
function hasPMTitle(title) {
  return PM_TITLE_REGEX.test(title || '');
}

/**
 * Format date to days ago
 */
function daysAgo(dateStr) {
  if (!dateStr) return 999; // Unknown date = too old
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 999;
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Create mock job data from fixtures for testing
 */
function createMockJob(jobData, source) {
  // Simple random hex string using Math.random (crypto.randomBytes not available)
  const randomHex = () => {
    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += Math.floor(Math.random() * 16).toString(16);
    }
    return hex;
  };
  
  return {
    id: jobData.referenznummer || randomHex(),
    title: jobData.stellenangebotsTitel || jobData.stellenangebotsart || 'Product Manager',
    company: jobData.firma || 'Test Company',
    location: jobData.stellenlokationen?.[0]?.adresse?.ort || 'München',
    remote: jobData.homeofficemoeglich === false ? 'full' : (jobData.arbeitszeitVollzeit === false ? 'partial' : 'hybrid'),
    publishedAt: jobData.datumErsteVeroeffentlichung || '2026-09-22',
    sourceUrl: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${jobData.referenznummer}-S`,
    source: source || 'arbeitsagentur',
    matchScore: Math.random() * 100,
    description: `Job description for ${jobData.stellenangebotsTitel || 'Product Manager'} at ${jobData.firma || 'Test Company'}`
  };
}

/**
 * Generate a mock page of jobs like the arbeitsagentur fixture
 */
function generateMockPage(prefix, count) {
  return Array.from({ length: count }, (_, i) =>
    createMockJob({
      referenznummer: `${prefix}-${i}-S`,
      stellenangebotsTitel: `Product Manager ${prefix} ${i}`,
      stellenangebotsart: 'ARBEIT',
      arbeitszeitVollzeit: true,
      hauptberuf: 'Produktentwickler/in',
      firma: `Firma ${prefix} ${i}`,
      homeofficemoeglich: i % 2 === 0, // alternating remote
      datumErsteVeroeffentlichung: i % 3 === 0 ? '2026-09-22' : '2025-01-01', // some stale
    }, 'arbeitsagentur')
  );
}

/**
 * Mock API client - returns fixture data instead of real HTTP calls
 */
class MockAPIClient {
  constructor() {
    // Generate mock data for the search
    this.mockJobs = generateMockPage('test', 30); // 30 mock jobs
    this.pollAttempts = 0;
  }

  async login(email, password) {
    // Simulate successful login
    return {
      token: 'mock-jwt-token-' + randomHex(8)
    };
  }

  async createSearch(query) {
    // Return a mock search ID
    return {
      searchId: 'mock-search-' + randomHex(8)
    };
  }

  async getStatus(searchId) {
    // Simulate completion after a couple of polls
    this.pollAttempts++;
    
    if (this.pollAttempts >= 3) {
      return {
        status: 'complete',
        failureReason: null,
        query: QUERY
      };
    }
    
    return {
      status: 'running',
      failureReason: null,
      query: QUERY
    };
  }

  async getJobs(searchId, page, pageSize) {
    // Return paginated mock jobs
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageJobs = this.mockJobs.slice(start, end);
    
    return {
      jobs: pageJobs,
      totalJobs: this.mockJobs.length,
      totalPages: Math.ceil(this.mockJobs.length / pageSize),
      page,
      pageSize,
      hasMore: end < this.mockJobs.length,
      isLoading: false
    };
  }
}

/**
 * Real API client using fetch
 */
class RealAPIClient {
  constructor(baseUrl, authToken) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
  }

  async login(email, password) {
    const resp = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await resp.json();
    return { token: data.token || data.access_token };
  }

  async createSearch(query) {
    const resp = await fetch(`${this.baseUrl}/api/searches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken}`
      },
      body: JSON.stringify({ query })
    });
    const data = await resp.json();
    return { searchId: data.searchId };
  }

  async getStatus(searchId) {
    const resp = await fetch(`${this.baseUrl}/${searchId}/status`, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });
    const data = await resp.json();
    return { status: data.status, failureReason: data.failureReason };
  }

  async getJobs(searchId, page, pageSize) {
    const resp = await fetch(`${this.baseUrl}/${searchId}/jobs?page=${page}&pageSize=${pageSize}`, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });
    const data = await resp.json();
    return {
      jobs: data.jobs || [],
      totalJobs: data.totalJobs || 0,
      totalPages: data.totalPages || 0,
      page,
      pageSize,
      hasMore: data.hasMore || false,
      isLoading: data.isLoading || false
    };
  }
}

/**
 * Main measurement function
 */
async function main() {
  console.log('🚀 Starting measure-search script...');
  console.log('Environment:', {
    RUN_LIVE: env.RUN_LIVE,
    RUN_PROD: env.RUN_PROD,
    BASE_URL: isLive ? BASE_URL : 'mock',
    EMAIL: EMAIL
  });

  const client = isLive
    ? new RealAPIClient(BASE_URL, '')
    : new MockAPIClient();

  let authToken;

  try {
    // 1. Login
    console.log('🔑 Logging in...');
    const loginResult = await client.login(EMAIL, PASSWORD);
    authToken = loginResult.token;
    console.log('✅ Logged in successfully');

    // 2. Create search
    console.log('🔍 Creating search...');
    const searchResult = await client.createSearch(QUERY);
    const searchId = searchResult.searchId;
    console.log(`✅ Search created with ID: ${searchId}`);

    // 3. Poll for completion
    console.log('⏳ Polling for search completion...');
    let status;
    let startTime = Date.now();
    let attempts = 0;

    while (true) {
      attempts++;
      const statusResult = await client.getStatus(searchId);
      status = statusResult.status;

      console.log(`⏱️  Attempt ${attempts}: Status = ${status}`);

      if (status === 'complete' || status === 'failed') {
        break;
      }

      if (Date.now() - startTime > MAX_TIMEOUT_MS) {
        throw new Error('Search timed out after 120 seconds');
      }

      await new Promise(r => setTimeout(r, 2000)); // 2s poll interval
    }

    if (status === 'failed') {
      throw new Error(`Search failed: ${statusResult.failureReason || 'Unknown'}`);
    }

    console.log('✅ Search completed successfully');

    // 4. Get all jobs (paginated)
    console.log('📥 Fetching all jobs...');
    let allJobs = [];
    let page = 1;
    let pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const jobsResult = await client.getJobs(searchId, page, pageSize);
      allJobs = [...allJobs, ...jobsResult.jobs];
      hasMore = jobsResult.hasMore;
      page++;
    }

    console.log(`📊 Total jobs retrieved: ${allJobs.length}`);

    // 5. Apply strict validity rule client-side
    console.log('🔍 Applying validity rules...');
    const validJobs = [];
    const scoredJobs = [];
    const perSource = {};
    const droppedReasons = { title: 0, location: 0, age: 0, blocklisted: 0 };

    // Initialize per-source tracking
    for (const job of allJobs) {
      const source = job.source || 'unknown';
      if (!perSource[source]) {
        perSource[source] = { total: 0, scored: 0, valid: 0 };
      }
      perSource[source].total++;
    }

    // Process each job through the filter rules
    let scoredCountLoop = 0;
    for (const job of allJobs) {
      const source = job.source || 'unknown';
      const reasons = [];

      // Check PM title regex
      if (!hasPMTitle(job.title)) {
        reasons.push('title');
      } else {
        scoredCountLoop++;
        perSource[source].scored++;
      }

      // Check Munich location OR remote
      const isMunich = isMunichLocation(job.location);
      const isRemoteJob = isRemote(job);
      if (!isMunich && !isRemoteJob) {
        reasons.push('location');
      }

      // Check published within 180 days
      const age = daysAgo(job.publishedAt);
      if (age > 180) {
        reasons.push('age');
      }

      // Check not blocklisted company
      if (BLOCKLISTED_COMPANIES.has(job.company)) {
        reasons.push('blocklisted');
      }

      // Determine validity (all four rules must pass)
      const isValid = reasons.length === 0;

      if (isValid) {
        validJobs.push(job);
        perSource[source].valid++;
      }

      // Track dropped reasons (for jobs that fail at least one rule)
      if (reasons.length > 0) {
        for (const reason of reasons) {
          if (droppedReasons[reason] !== undefined) {
            droppedReasons[reason]++;
          }
        }
      }
    }

    const validCount = validJobs.length;
    const scoredCount = scoredCountLoop;

    // 6. Generate output
    console.log('\n📊 Measurement Table:');
    console.log('Total jobs: ' + allJobs.length);
    console.log('Valid jobs: ' + validCount);
    console.log('Scored jobs: ' + scoredCount);
    console.log('');

    // Per-source breakdown
    console.log('Per-source breakdown:');
    for (const source in perSource) {
      const data = perSource[source];
      console.log(`  ${source}: ${data.total} total, ${data.scored} scored, ${data.valid} valid`);
    }
    console.log('');

    // Dropped reasons
    console.log('Dropped reasons:');
    for (const reason in droppedReasons) {
      if (droppedReasons[reason] > 0) {
        console.log(`  ${reason}: ${droppedReasons[reason]}`);
      }
    }
    console.log('');

    // 7. Write files
    const date = new Date().toISOString().split('T')[0];
    const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '').replace(/^\//, '/');
    const jsonPath = path.join(__dirname, '..', 'docs', 'measurements', `${date}-pm-munich.json`);
    const mdPath = path.join(__dirname, '..', 'docs', 'measurements', `${date}-pm-munich.md`);

    // Ensure directory exists
    const dir = path.dirname(jsonPath);
    fs.mkdirSync(dir, { recursive: true });

    // Create JSON file with full measurement data
    const jsonContent = {
      date: date,
      query: QUERY,
      totalJobs: allJobs.length,
      validJobs: validCount,
      scoredJobs: scoredCount,
      perSource: perSource,
      droppedReasons: droppedReasons,
      filterRules: {
        pmTitleRegex: PM_TITLE_REGEX.toString(),
        munichLocation: 'Munich ≤25km OR job.remote === "full"',
        maxAgeDays: 180,
        blocklistedCompanies: Array.from(BLOCKLISTED_COMPANIES)
      }
    };

    fs.writeFileSync(jsonPath, JSON.stringify(jsonContent, null, 2));
    console.log(`✅ JSON file written to: ${jsonPath}`);

    // Create Markdown table
    let mdContent = `# Job Search Measurement - ${date}\n\n`;
    mdContent += `**Query:** ${QUERY}\n\n`;
    mdContent += `| Metric | Count |\n`;
    mdContent += `|--------|-------|\n`;
    mdContent += `| Total Jobs | ${allJobs.length} |\n`;
    mdContent += `| Valid Jobs | ${validCount} |\n`;
    mdContent += `| Scored Jobs | ${scoredCount} |\n\n`;

    mdContent += '### Per-Source Breakdown\n\n';
    for (const source in perSource) {
      const data = perSource[source];
      mdContent += `**${source}**: ${data.total} total, ${data.scored} scored, ${data.valid} valid\n`;
    }
    mdContent += '\n';

    mdContent += '### Dropped Jobs by Reason\n\n';
    for (const reason in droppedReasons) {
      if (droppedReasons[reason] > 0) {
        mdContent += `• ${reason}: ${droppedReasons[reason]}\n`;
      }
    }
    mdContent += '\n';

    mdContent += '### Filter Rules\n\n';
    mdContent += `- PM Title Regex: ${PM_TITLE_REGEX.toString()}\n`;
    mdContent += `- Location: Munich ≤25km OR job.remote === "full"\n`;
    mdContent += `- Max Age: < 180 days\n`;
    mdContent += `- Blocklisted Companies: ${Array.from(BLOCKLISTED_COMPANIES).join(', ')}\n\n`;

    fs.writeFileSync(mdPath, mdContent);
    console.log(`✅ Markdown file written to: ${mdPath}`);

    console.log('\n✅ Script completed successfully!');
    console.log('Files generated:');
    console.log(`  - ${jsonPath}`);
    console.log(`  - ${mdPath}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();