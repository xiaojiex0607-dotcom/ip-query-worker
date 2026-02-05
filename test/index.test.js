import { describe, it, expect, beforeEach } from '@jest/globals';
import { IPDatabase } from '../src/database.js';

describe('IP Database', () => {
  let db;
  
  beforeEach(() => {
    db = new IPDatabase({});
  });
  
  it('should convert IP to integer', () => {
    const result = db.ipToInt('192.168.1.1');
    expect(result).toBe(3232235777);
  });
  
  it('should handle invalid IP', () => {
    expect(() => db.ipToInt('invalid')).toThrow();
  });
  
  it('should create fallback database', () => {
    const fallback = db.createFallbackDatabase();
    expect(fallback).toBeDefined();
  });
});
