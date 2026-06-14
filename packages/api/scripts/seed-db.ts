import { connectDB, disconnectDB } from '../src/db'
import { UserModel, SearchSessionModel, JobModel } from '../src/db/models'
import bcryptjs from 'bcryptjs'

const testUsers = [
  {
    email: 'test@example.com',
    password: 'password123',
    claudeApiToken: 'replace-with-real-token'
  },
  {
    email: 'demo@example.com',
    password: 'demo123',
    claudeApiToken: 'replace-with-real-token'
  }
]

async function seed() {
  try {
    console.log('🌱 Connecting to database...')
    await connectDB()

    console.log('🗑️  Clearing existing test users...')
    await UserModel.deleteMany({ email: { $in: testUsers.map(u => u.email) } })
    await SearchSessionModel.deleteMany({})
    await JobModel.deleteMany({})

    console.log('👤 Creating test users...')
    const createdUsers = []

    for (const user of testUsers) {
      const passwordHash = await bcryptjs.hash(user.password, 10)
      const newUser = await UserModel.create({
        email: user.email,
        passwordHash,
        claudeApiToken: user.claudeApiToken
      })
      createdUsers.push(newUser)
      console.log(`   ✅ Created: ${user.email}`)
    }

    console.log('\n📋 Test Credentials:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    testUsers.forEach((user, i) => {
      const userId = createdUsers[i]._id.toString()
      console.log(`\nAccount ${i + 1}:`)
      console.log(`  Email:    ${user.email}`)
      console.log(`  Password: ${user.password}`)
      console.log(`  User ID:  ${userId}`)
    })
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('📝 Test API call:')
    console.log(`curl -X POST http://localhost:3000/api/auth/login \\`)
    console.log(`  -H "Content-Type: application/json" \\`)
    console.log(`  -d '{"email":"${testUsers[0].email}","password":"${testUsers[0].password}"}'`)
    console.log('')

    console.log('✨ Database seeded successfully!')
    await disconnectDB()
    process.exit(0)
  } catch (error) {
    console.error('❌ Seed failed:', error)
    await disconnectDB()
    process.exit(1)
  }
}

seed()
