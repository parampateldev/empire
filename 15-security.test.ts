import { describe, it, expect } from 'vitest'
import rules from '../database.rules.json'

describe('database rule boundaries', () => {
  it('lets the authenticated host create a room atomically', () => {
    expect(rules.rules.rooms.$room['.write']).toContain('!data.exists()')
    expect(rules.rules.rooms.$room['.write']).toContain("newData.child('hostId').val() === auth.uid")
  })

  it('keeps secrets outside publicly readable rooms', () => {
    expect(rules.rules.rooms.$room).not.toHaveProperty('submissions')
    expect(rules.rules.submissions.$room.$uid['.read']).toContain('auth.uid === $uid')
  })

  it('denies reveal reads after the deadline', () => {
    expect(rules.rules.reveals.$room['.read']).toContain("now < data.child('endsAt').val()")
  })
})
