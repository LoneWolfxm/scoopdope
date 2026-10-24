import { CollaborationGateway } from './collaboration.gateway';
import { PresenceService } from './presence.service';
import { JwtService } from '@nestjs/jwt';

describe('CollaborationGateway', () => {
  let gateway: CollaborationGateway;
  let presence: PresenceService;
  let jwtService: JwtService;
  let emits: Array<{ room: string; event: string; payload: any }>;
  let mockServer: any;
  let client: any;

  beforeEach(() => {
    emits = [];
    mockServer = {
      to: (room: string) => ({
        emit: (event: string, payload: any) => emits.push({ room, event, payload }),
      }),
      emit: (event: string, payload: any) => emits.push({ room: '*', event, payload }),
    };
    presence = new PresenceService();
    jwtService = { verify: jest.fn().mockReturnValue({ sub: 'user1' }) } as any;
    gateway = new CollaborationGateway(presence, jwtService);
    (gateway as any).server = mockServer;
    client = { id: 'sock1', join: jest.fn(), leave: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), handshake: { auth: { token: 'valid-token' } } };
  });

  it('onJoin registers presence and broadcasts to the course room', () => {
    gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });

    expect(presence.isPresent('c1', 'i1')).toBe(true);
    expect(client.join).toHaveBeenCalledWith('c1');

    const presenceEmit = emits.find((e) => e.event === 'presence' && e.room === 'c1');
    expect(presenceEmit).toBeDefined();
    expect(presenceEmit!.payload.map((p: any) => p.instructorId)).toContain('i1');
  });

  it('course-update broadcasts when accepted', () => {
    gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });
    emits.length = 0;

    const res = gateway.onCourseUpdate(client, {
      courseId: 'c1',
      instructorId: 'i1',
      baseVersion: 0,
      payload: { title: 'new' },
    });

    expect(res.accepted).toBe(true);
    const upd = emits.find((e) => e.event === 'course-updated' && e.room === 'c1');
    expect(upd).toBeDefined();
    expect(upd!.payload.version).toBe(1);
  });

  it('course-update emits a conflict to the editor on a stale base version', () => {
    gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });
    gateway.onCourseUpdate(client, { courseId: 'c1', instructorId: 'i1', baseVersion: 0 });
    emits.length = 0;

    const res = gateway.onCourseUpdate(client, {
      courseId: 'c1',
      instructorId: 'i2',
      baseVersion: 0,
    });

    expect(res.conflict).toBe(true);
    expect(client.emit).toHaveBeenCalledWith(
      'update-conflict',
      expect.objectContaining({ currentVersion: 1 }),
    );
  });

  it('handleDisconnect clears presence', () => {
    gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });
    gateway.handleDisconnect(client);
    expect(presence.isPresent('c1', 'i1')).toBe(false);
  });

  describe('disconnect cleanup integration', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('clean disconnect removes the user from the room and broadcasts the updated participant list', () => {
      gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });
      const otherClient = {
        ...client,
        id: 'sock2',
        join: jest.fn(),
        leave: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };
      gateway.onJoin(otherClient, { courseId: 'c1', instructorId: 'i2' });
      emits.length = 0;

      gateway.handleDisconnect(client);

      expect(presence.isPresent('c1', 'i1')).toBe(false);
      expect(presence.isPresent('c1', 'i2')).toBe(true);
      expect(client.leave).toHaveBeenCalledWith('c1');

      const presenceEmit = emits.find((e) => e.event === 'presence' && e.room === 'c1');
      expect(presenceEmit).toBeDefined();
      const ids = presenceEmit!.payload.map((p: any) => p.instructorId);
      expect(ids).not.toContain('i1');
      expect(ids).toContain('i2');
      expect(presence.getActiveCount('c1')).toBe(1);
    });

    it('abrupt disconnect is cleaned up within 60 seconds via heartbeat TTL', () => {
      jest.useFakeTimers();
      gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });
      expect(presence.getActiveCount('c1')).toBe(1);

      // Simulate abrupt disconnect: no handleDisconnect call, just stop heartbeats.
      jest.advanceTimersByTime(59_000);
      expect(presence.isPresent('c1', 'i1')).toBe(true);
      expect(presence.getActiveCount('c1')).toBe(1);

      jest.advanceTimersByTime(1_000);
      gateway.sweepStaleParticipants();

      expect(presence.isPresent('c1', 'i1')).toBe(false);
      expect(presence.getActiveCount('c1')).toBe(0);

      const presenceEmit = emits.find((e) => e.event === 'presence' && e.room === 'c1');
      expect(presenceEmit).toBeDefined();
      expect(presenceEmit!.payload).toHaveLength(0);
    });

    it('heartbeats keep a participant alive past the TTL window', () => {
      jest.useFakeTimers();
      gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });

      jest.advanceTimersByTime(30_000);
      gateway.onHeartbeat(client, { courseId: 'c1', instructorId: 'i1' });
      jest.advanceTimersByTime(30_000);
      gateway.sweepStaleParticipants();

      expect(presence.isPresent('c1', 'i1')).toBe(true);
      expect(presence.getActiveCount('c1')).toBe(1);
    });
  });

  it('enrollment-event broadcasts a notification to the course room', () => {
    gateway.onJoin(client, { courseId: 'c1', instructorId: 'i1' });
    emits.length = 0;

    gateway.onEnrollment(client, { courseId: 'c1', studentId: 's1' });

    const notif = emits.find((e) => e.event === 'enrollment-notification' && e.room === 'c1');
    expect(notif).toBeDefined();
    expect(notif!.payload.studentId).toBe('s1');
  });

  describe('handleConnection', () => {
    it('disconnects client when no token is provided', async () => {
      const unauthedClient = { ...client, handshake: { auth: {} }, disconnect: jest.fn() };
      await gateway.handleConnection(unauthedClient as any);
      expect(unauthedClient.disconnect).toHaveBeenCalled();
    });

    it('disconnects client when token is invalid', async () => {
      jwtService.verify.mockImplementationOnce(() => { throw new Error('Invalid token'); });
      const unauthedClient = { ...client, handshake: { auth: { token: 'bad-token' } }, disconnect: jest.fn() };
      await gateway.handleConnection(unauthedClient as any);
      expect(unauthedClient.disconnect).toHaveBeenCalled();
    });

    it('allows connection when token is valid', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user1' });
      const authedClient = { ...client, handshake: { auth: { token: 'valid-token' } }, disconnect: jest.fn() };
      await gateway.handleConnection(authedClient as any);
      expect(authedClient.disconnect).not.toHaveBeenCalled();
    });
  });
});
