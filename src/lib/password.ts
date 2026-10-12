import bcrypt from "bcryptjs";

const ROUNDS = 12;

export const MIN_PASSWORD_LENGTH = 10;

/**
 * The passwords that actually show up in credential-stuffing lists, normalised
 * to lowercase.
 *
 * NIST SP 800-63B's guidance is a long minimum plus a check against known
 * compromised secrets, rather than composition rules (one capital, one digit)
 * that push people toward `Password1!`. This is a deliberately small, offline
 * stand-in for that check: it costs nothing and blocks the guesses an attacker
 * actually tries first. A production deployment should swap this for a Have I
 * Been Pwned range query -- see SECURITY.md.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "123456789",
  "1234567890",
  "12345678901",
  "qwertyuiop",
  "qwerty123",
  "qwerty1234",
  "letmein123",
  "welcome123",
  "admin12345",
  "administrator",
  "iloveyou123",
  "monkey1234",
  "dragon1234",
  "football123",
  "baseball123",
  "sunshine123",
  "princess123",
  "trustno1234",
  "superman123",
  "batman12345",
  "starwars123",
  "whatever123",
  "changeme123",
  "secret1234",
  "default1234",
  "temporary1",
  "abcd1234567",
  "abc123456789",
  "asdfghjkl123",
  "zxcvbnm1234",
  "1qaz2wsx3edc",
  "qazwsxedc123",
  "michael1234",
  "jennifer123",
  "computer123",
  "internet123",
  "bismillah123",
  "myp@ssword1",
  "p@ssw0rd123",
]);

export type PasswordProblem = string | null;

/** Returns a message explaining why a password is unacceptable, or null. */
export function validatePasswordStrength(password: string): PasswordProblem {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) {
    return "Password is too long";
  }

  const normalised = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalised)) {
    return "That password appears in lists of commonly used passwords. Pick another.";
  }

  // A single repeated character is long but has no entropy.
  if (new Set(password).size < 5) {
    return "Password is too repetitive. Use a longer mix of characters.";
  }

  return null;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  // Compare against a throwaway hash when the account has no password (it was
  // created through OAuth) so the response time does not reveal which it is.
  if (!hash) {
    await bcrypt.compare(plain, "$2a$12$........................................................");
    return false;
  }
  return bcrypt.compare(plain, hash);
}
