import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PresenceService } from './presence.service';

interface Session {
  courseId: string;
  instructorId: string;
}

/** Participants with no heartbeat for this long are treated as disconnected. */
const HEARTBEAT_TTL_MS = 60_000;
/** How often the server sweeps for stale participants. */
const HEARTBEAT_SWEEP_INTERVAL_MS = 10_000;

/**
 * Real-time collaboration gateway for instructors working on the same course.
 *
 * Events:
 *  - `join`              -> instructor joins a course room + broadcasts presence
 *  - `course-update`     -> broadcasts an accepted course change (with conflict detection)
 *  - `enrollment-event`  -> broadcasts a new-enrollment notification to the course room
 *  - `leave`             -> instructor leaves + presence cleared
 *  - disconnect          -> presence cleared (graceful handling of network drops)
 */
@WebSocketGateway({ namespace: '/collaboration', cors: { origin: '*' } })
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CollaborationGateway.name);
  @WebSocketServer() server: Server;

  /** socketId -> session, so we can clear presence on disconnect. */
  private readonly sockets = new Map<string, Session>();

  /** courseId -> instructorId -> last heartbeat timestamp (ms). */
  private readonly heartbeats = new Map<string, Map<string, number>>();

  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly presence: PresenceService,
    private readonly jwtService: JwtService,
  ) {}

  afterInit(): void {
    this.sweepTimer = setInterval(() => this.sweepStaleParticipants(), HEARTBEAT_SWEEP_INTERVAL_MS);
    // Do not keep the process alive just for the sweep.
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }
    try {
      this.jwtService.verify<{ sub: string }>(token);
      this.logger.debug(`Collaboration socket connected: ${client.id}`);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join')
  onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { courseId: string; instructorId: string; editingResource?: string },
  ) {
    const { courseId, instructorId, editingResource } = data;
    this.sockets.set(client.id, { courseId, instructorId });
    this.presence.join(courseId, instructorId, editingResource);
    this.touchHeartbeat(courseId, instructorId);
    client.join(courseId);
    this.broadcastPresence(courseId);
    return { event: 'joined', courseId, instructorId };
  }

  @SubscribeMessage('heartbeat')
  onHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { courseId?: string; instructorId?: string },
  ) {
    const session = this.sockets.get(client.id);
    const courseId = data?.courseId ?? session?.courseId;
    const instructorId = data?.instructorId ?? session?.instructorId;
    if (!courseId || !instructorId) return { ok: false };
    this.presence.touch(courseId, instructorId);
    this.touchHeartbeat(courseId, instructorId);
    return { ok: true, at: Date.now() };
  }

  @SubscribeMessage('course-update')
  onCourseUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { courseId: string; instructorId: string; baseVersion: number; payload?: unknown },
  ) {
    const result = this.presence.applyCourseUpdate(
      data.courseId,
      data.instructorId,
      data.baseVersion,
    );
    if (result.accepted) {
      this.server.to(data.courseId).emit('course-updated', {
        courseId: data.courseId,
        instructorId: data.instructorId,
        version: result.currentVersion,
        payload: data.payload,
      });
    } else {
      client.emit('update-conflict', {
        courseId: data.courseId,
        currentVersion: result.currentVersion,
      });
    }
    return result;
  }

  @SubscribeMessage('enrollment-event')
  onEnrollment(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { courseId: string; studentId: string },
  ) {
    this.server.to(data.courseId).emit('enrollment-notification', {
      courseId: data.courseId,
      studentId: data.studentId,
      at: Date.now(),
    });
    return { broadcast: true };
  }

  @SubscribeMessage('leave')
  onLeave(@ConnectedSocket() client: Socket) {
    const session = this.sockets.get(client.id);
    if (!session) return { left: false };
    this.presence.leave(session.courseId, session.instructorId);
    this.clearHeartbeat(session.courseId, session.instructorId);
    client.leave(session.courseId);
    this.sockets.delete(client.id);
    this.broadcastPresence(session.courseId);
    return { left: true, courseId: session.courseId };
  }

  handleDisconnect(client: Socket): void {
    const session = this.sockets.get(client.id);
    if (!session) return;
    this.presence.leave(session.courseId, session.instructorId);
    this.clearHeartbeat(session.courseId, session.instructorId);
    this.sockets.delete(client.id);
    // Remove the socket from every room it was in, not just the course room.
    for (const room of client.rooms) {
      if (room !== client.id) client.leave(room);
    }
    this.broadcastPresence(session.courseId);
    this.logger.log(`socket ${client.id} disconnected; cleared presence for ${session.instructorId}`);
  }

  /** Server-side helper so other modules (e.g. enrollments) can push events. */
  broadcastEnrollment(courseId: string, studentId: string): void {
    this.server.to(courseId).emit('enrollment-notification', {
      courseId,
      studentId,
      at: Date.now(),
    });
  }

  private broadcastPresence(courseId: string): void {
    this.server.to(courseId).emit('presence', this.presence.getActive(courseId));
  }

  private touchHeartbeat(courseId: string, instructorId: string): void {
    let course = this.heartbeats.get(courseId);
    if (!course) {
      course = new Map<string, number>();
      this.heartbeats.set(courseId, course);
    }
    course.set(instructorId, Date.now());
  }

  private clearHeartbeat(courseId: string, instructorId: string): void {
    const course = this.heartbeats.get(courseId);
    if (!course) return;
    course.delete(instructorId);
    if (course.size === 0) this.heartbeats.delete(courseId);
  }

  /** Treat participants with no heartbeat within the TTL as disconnected. */
  private sweepStaleParticipants(): void {
    const now = Date.now();
    for (const [courseId, course] of this.heartbeats) {
      let changed = false;
      for (const [instructorId, lastSeen] of course) {
        if (now - lastSeen <= HEARTBEAT_TTL_MS) continue;
        course.delete(instructorId);
        this.presence.leave(courseId, instructorId);
        // Drop any sockets belonging to the stale participant.
        for (const [socketId, session] of this.sockets) {
          if (session.courseId === courseId && session.instructorId === instructorId) {
            this.sockets.delete(socketId);
            const socket = this.server?.sockets?.sockets?.get(socketId);
            socket?.disconnect(true);
          }
        }
        changed = true;
        this.logger.warn(
          `participant ${instructorId} timed out in course ${courseId}; removed from presence`,
        );
      }
      if (course.size === 0) this.heartbeats.delete(courseId);
      if (changed) this.broadcastPresence(courseId);
    }
  }
}
