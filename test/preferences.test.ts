import { describe, expect, it } from 'vitest'
import {
  positiveOrZero,
  clampTurns,
  clampAttempts,
  MAX_REPAIR_ATTEMPTS,
  MAX_TURNS_CEILING,
} from '../server/utils/preferences'

describe('positiveOrZero', () => {
  it('passes through a positive number', () => {
    expect(positiveOrZero(5)).toBe(5)
    expect(positiveOrZero(0.01)).toBe(0.01)
    expect(positiveOrZero(1000)).toBe(1000)
  })

  it('returns 0 for zero', () => {
    expect(positiveOrZero(0)).toBe(0)
  })

  it('returns 0 for negative numbers', () => {
    expect(positiveOrZero(-1)).toBe(0)
    expect(positiveOrZero(-0.5)).toBe(0)
  })

  it('returns 0 for non-numbers', () => {
    expect(positiveOrZero('5')).toBe(0)
    expect(positiveOrZero(null)).toBe(0)
    expect(positiveOrZero(undefined)).toBe(0)
    expect(positiveOrZero(true)).toBe(0)
    expect(positiveOrZero({})).toBe(0)
  })

  it('returns 0 for Infinity and NaN', () => {
    expect(positiveOrZero(Infinity)).toBe(0)
    expect(positiveOrZero(-Infinity)).toBe(0)
    expect(positiveOrZero(NaN)).toBe(0)
  })
})

describe('clampTurns', () => {
  it('returns 0 for zero or missing — meaning use the default', () => {
    expect(clampTurns(0)).toBe(0)
    expect(clampTurns(undefined)).toBe(0)
    expect(clampTurns(null)).toBe(0)
    expect(clampTurns(-1)).toBe(0)
  })

  it('passes through a reasonable number', () => {
    expect(clampTurns(40)).toBe(40)
    expect(clampTurns(1)).toBe(1)
  })

  it('floors fractional turns', () => {
    expect(clampTurns(40.9)).toBe(40)
    expect(clampTurns(1.5)).toBe(1)
  })

  it('caps at the SDK ceiling', () => {
    expect(clampTurns(MAX_TURNS_CEILING)).toBe(MAX_TURNS_CEILING)
    expect(clampTurns(MAX_TURNS_CEILING + 1)).toBe(MAX_TURNS_CEILING)
    expect(clampTurns(9999)).toBe(MAX_TURNS_CEILING)
  })

  it('returns 0 for non-numbers', () => {
    expect(clampTurns('50')).toBe(0)
    expect(clampTurns(NaN)).toBe(0)
    expect(clampTurns(Infinity)).toBe(0)
  })
})

describe('clampAttempts', () => {
  it('returns 0 for zero or missing', () => {
    expect(clampAttempts(0)).toBe(0)
    expect(clampAttempts(undefined)).toBe(0)
    expect(clampAttempts(-1)).toBe(0)
  })

  it('passes through a reasonable number', () => {
    expect(clampAttempts(3)).toBe(3)
    expect(clampAttempts(1)).toBe(1)
  })

  it('floors fractional attempts', () => {
    expect(clampAttempts(3.7)).toBe(3)
  })

  it('caps at MAX_REPAIR_ATTEMPTS', () => {
    expect(clampAttempts(MAX_REPAIR_ATTEMPTS)).toBe(MAX_REPAIR_ATTEMPTS)
    expect(clampAttempts(MAX_REPAIR_ATTEMPTS + 1)).toBe(MAX_REPAIR_ATTEMPTS)
    expect(clampAttempts(500)).toBe(MAX_REPAIR_ATTEMPTS)
  })

  it('returns 0 for non-numbers', () => {
    expect(clampAttempts('3')).toBe(0)
    expect(clampAttempts(NaN)).toBe(0)
  })
})
