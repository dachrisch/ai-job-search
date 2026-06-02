import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces'

export class MockSource implements JobSource {
  name = 'MockSource'

  canHandle(domain: string): boolean {
    // MockSource handles any domain as a fallback
    return true
  }

  async scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult> {
    const mockJobs = [
      {
        title: 'Senior Software Engineer',
        company: 'TechCorp Inc.',
        description: 'We are looking for an experienced Senior Software Engineer to join our growing team.',
        url: 'https://techcorp.com/jobs/senior-engineer',
        sourceUrl: 'https://techcorp.com',
        salary: '$150,000 - $200,000',
        location: 'San Francisco, CA'
      },
      {
        title: 'Full Stack Developer',
        company: 'CloudTech Solutions',
        description: 'Join our dynamic team as a Full Stack Developer. Experience with React, Node.js required.',
        url: 'https://cloudtech.com/careers/full-stack',
        sourceUrl: 'https://cloudtech.com',
        salary: '$120,000 - $160,000',
        location: 'Remote'
      },
      {
        title: 'Backend Engineer - Python',
        company: 'DataSystems Ltd',
        description: 'We are seeking a Backend Engineer with Python expertise to build scalable microservices.',
        url: 'https://datasystems.com/jobs/backend-python',
        sourceUrl: 'https://datasystems.com',
        salary: '$130,000 - $180,000',
        location: 'New York, NY'
      },
      {
        title: 'Frontend Engineer React',
        company: 'StartupXYZ',
        description: 'Looking for a talented Frontend Engineer with React expertise.',
        url: 'https://startupxyz.com/jobs/frontend-react',
        sourceUrl: 'https://startupxyz.com',
        salary: '$110,000 - $150,000',
        location: 'Austin, TX'
      },
      {
        title: 'Software Architect',
        company: 'Enterprise Solutions Corp',
        description: 'Design and build large-scale software systems. 10+ years of experience required.',
        url: 'https://enterprisesol.com/jobs/architect',
        sourceUrl: 'https://enterprisesol.com',
        salary: '$180,000 - $250,000',
        location: 'Seattle, WA'
      },
      {
        title: 'DevOps Engineer',
        company: 'CloudInfra Inc',
        description: 'Manage and optimize our cloud infrastructure. Kubernetes and Docker experience essential.',
        url: 'https://cloudinfra.com/jobs/devops',
        sourceUrl: 'https://cloudinfra.com',
        salary: '$125,000 - $165,000',
        location: 'Remote'
      }
    ]

    return {
      jobs: mockJobs,
      errors: [],
      source: this.name,
      timestamp: new Date()
    }
  }

  async scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]> {
    return Promise.all(urls.map(url => this.scrape(url, keywords, config)))
  }
}
