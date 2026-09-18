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

  it('lets only the host read a reveal list once it exists', () => {
    const read = rules.rules.reveals.$room['.read']
    expect(read).toContain('!data.exists()')
    expect(read).toContain("root.child('rooms/'+$room+'/hostId').val() === auth.uid")
  })

  it('lets only the host write a reveal list', () => {
    expect(rules.rules.reveals.$room['.write']).toContain("root.child('rooms/'+$room+'/hostId').val() === auth.uid")
  })

  it('lets the host remove a player submission', () => {
    expect(rules.rules.submissions.$room.$uid['.write']).toContain("root.child('rooms/'+$room+'/hostId').val() === auth.uid")
  })
})
