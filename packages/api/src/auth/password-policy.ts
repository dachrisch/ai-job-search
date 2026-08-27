// Password strength policy (audit finding E1).
//
// Enforces a minimum length and rejects a list of the most common/weak
// passwords so trivially guessable credentials (verified live on the old
// site: 1-character passwords were accepted) cannot be registered.

export const MIN_PASSWORD_LENGTH = 8

// Top ~100 most common passwords (NordPass / "worst passwords" lists).
// Kept lowercase for case-insensitive comparison.
const COMMON_PASSWORDS = new Set<string>([
  '123456', '123456789', '12345', '12345678', '1234567', '1234567890',
  'qwerty', 'abc123', 'password', 'password1', 'passw0rd', 'p@ssw0rd',
  '111111', '123123', 'admin', 'letmein', 'welcome', 'monkey', 'dragon',
  'sunshine', 'princess', 'qwerty123', 'football', 'iloveyou', 'abc123456',
  '1234', '000000', 'Iloveyou', '654321', '1q2w3e', '1qaz2wsx',
  'zaq12wsx', 'qwertyuiop', 'superman', 'batman', 'trustno1', 'whatever',
  'shadow', 'master', 'jordan', 'harley', 'ranger', 'iampassword',
  'ninja', 'mustang', 'michael', 'jennifer', 'hunter', 'freedom',
  'qwerty1', 'qwerty12', 'qwertyui', 'q1w2e3r4', 'qwerty12345',
  'login', 'pass', 'secret', 'test', 'test123', 'guest', 'root',
  'user', 'admin123', 'administrator', 'changeme', 'default',
  'hello', 'hello123', 'qazwsx', 'pass123', 'password123', 'pw123456',
  'mypass', 'mypassword', 'google', 'yahoo', 'liverpool', 'chelsea',
  'charlie', 'andrew', 'daniel', 'matthew', 'tigger', 'poohbear',
  'cookie', 'flower', 'soccer', 'baseball', 'basketball', 'starwars',
  'introduce', 'greenday', 'blink182', 'computer', 'internet', 'server',
  'security', 'network', 'campbell', 'nicole', 'america', 'freedom1',
])

export interface PasswordValidationResult {
  valid: boolean
  error?: string
}

export function validatePassword(password: string): PasswordValidationResult {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    }
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      valid: false,
      error: 'Password is too common or weak. Please choose a less guessable password',
    }
  }

  return { valid: true }
}
