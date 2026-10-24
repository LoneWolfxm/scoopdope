import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { Course } from '../src/courses/course.entity';
import { Enrollment } from '../src/enrollments/enrollment.entity';
import { Certificate } from '../src/certificates/certificate.entity';
import { RefreshToken } from '../src/auth/refresh-token.entity';
import { PasswordResetToken } from '../src/auth/password-reset-token.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

describe('Pact Provider Verification', () => {
  let app: INestApplication;
  let userRepo: Repository<User>;
  let courseRepo: Repository<Course>;
  let verifier: Verifier;

  const providerPort = parseInt(process.env.PACT_PROVIDER_PORT ?? '3000', 10);
  const providerBaseUrl =
    process.env.PACT_PROVIDER_BASE_URL ?? `http://localhost:${providerPort}`;
  const brokerBaseUrl = process.env.PACT_BROKER_BASE_URL;
  const brokerToken = process.env.PACT_BROKER_TOKEN;
  const providerVersion =
    process.env.PACT_PROVIDER_VERSION ??
    process.env.GITHUB_SHA ??
    '1.0.0';
  const pactDir = path.resolve(__dirname, '../../pacts');

  /**
   * Resolve the pact sources for verification.
   * - When PACT_BROKER_BASE_URL is set, fetch pacts from the broker.
   * - Otherwise, read local pact files from the pacts/ directory.
   * Fails fast if no pacts can be found so CI never silently passes.
   */
  const resolvePactSources = (): {
    pactBrokerUrl?: string;
    pactBrokerToken?: string;
    consumerVersionSelectors?: Array<{ mainBranch?: boolean; deployedOrReleased?: boolean }>;
    providerVersion?: string;
    publishVerificationResult?: boolean;
    pactUrls?: string[];
  } => {
    if (brokerBaseUrl) {
      return {
        pactBrokerUrl: brokerBaseUrl,
        pactBrokerToken: brokerToken,
        consumerVersionSelectors: [{ mainBranch: true }, { deployedOrReleased: true }],
        providerVersion,
        publishVerificationResult: process.env.CI === 'true',
      };
    }

    if (!fs.existsSync(pactDir)) {
      throw new Error(
        `Pact directory not found at ${pactDir}. ` +
          'Run the frontend consumer tests to generate pact files, or set PACT_BROKER_BASE_URL.',
      );
    }

    const pactFiles = fs
      .readdirSync(pactDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.join(pactDir, file));

    if (pactFiles.length === 0) {
      throw new Error(
        `No pact files found in ${pactDir}. ` +
          'Run the frontend consumer tests to generate pact files, or set PACT_BROKER_BASE_URL.',
      );
    }

    return { pactUrls: pactFiles };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        AppModule,
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [User, Course, Enrollment, Certificate, RefreshToken, PasswordResetToken],
          synchronize: true,
          dropSchema: true,
        }),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Start the app on a configurable port so the Verifier can make requests
    await app.listen(providerPort);

    userRepo = app.get(getRepositoryToken(User));
    courseRepo = app.get(getRepositoryToken(Course));

    verifier = new Verifier({
      provider: 'Scoopdope-Backend',
      providerBaseUrl,
      ...resolvePactSources(),
      stateHandlers: {
        // ── Auth ──────────────────────────────────────
        'user does not exist': async () => {
          // DB starts empty
        },
        'user with email exists': async () => {
          const hashedPassword = await bcrypt.hash('Test@1234!', 10);
          await userRepo.save(
            userRepo.create({
              email: 'existing@test.com',
              passwordHash: hashedPassword,
              username: 'existinguser',
              role: 'student',
            }),
          );
        },
        'user with id exists': async () => {
          const hashedPassword = await bcrypt.hash('Test@1234!', 10);
          await userRepo.save(
            userRepo.create({
              id: '1',
              email: 'user1@test.com',
              passwordHash: hashedPassword,
              username: 'user1',
              role: 'student',
            }),
          );
        },
        'user is an instructor': async () => {
          const hashedPassword = await bcrypt.hash('Test@1234!', 10);
          await userRepo.save(
            userRepo.create({
              id: '2',
              email: 'instructor@test.com',
              passwordHash: hashedPassword,
              username: 'instructor',
              role: 'instructor',
            }),
          );
        },
        'user is an admin': async () => {
          const hashedPassword = await bcrypt.hash('Test@1234!', 10);
          await userRepo.save(
            userRepo.create({
              id: '3',
              email: 'admin@test.com',
              passwordHash: hashedPassword,
              username: 'admin',
              role: 'admin',
            }),
          );
        },
        'valid JWT token': async () => {
          // Token validation happens in request headers
        },
        'invalid JWT token': async () => {
          // Invalid token sent in request headers
        },
        'user has a Stellar public key': async () => {
          const hashedPassword = await bcrypt.hash('Test@1234!', 10);
          await userRepo.save(
            userRepo.create({
              id: '4',
              email: 'stellar@test.com',
              passwordHash: hashedPassword,
              username: 'stellaruser',
              role: 'student',
              stellarPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
            }),
          );
        },

        // ── Courses ───────────────────────────────────
        'courses exist': async () => {
          await courseRepo.save(
            courseRepo.create({
              title: 'Introduction to Stellar',
              description: 'Learn Stellar basics',
              level: 'beginner',
              status: 'published',
            }),
          );
        },
        'course with id exists': async () => {
          await courseRepo.save(
            courseRepo.create({
              id: 'course-1',
              title: 'Advanced Stellar Development',
              description: 'Advanced course on Stellar',
              level: 'advanced',
              status: 'published',
            }),
          );
        },
        'published course exists': async () => {
          await courseRepo.save(
            courseRepo.create({
              title: 'Published Course',
              description: 'A published course',
              level: 'beginner',
              status: 'published',
            }),
          );
        },
        'draft course exists': async () => {
          await courseRepo.save(
            courseRepo.create({
              title: 'Draft Course',
              description: 'A draft course',
              level: 'beginner',
              status: 'draft',
            }),
          );
        },

        // ── Credentials ──────────────────────────────────────
        'user has credentials': async () => {
          const user = await userRepo.save(
            userRepo.create({
              email: 'creds@test.com',
              passwordHash: await bcrypt.hash('Test@1234!', 10),
              username: 'credsuser',
              role: 'student',
            }),
          );
          await courseRepo.save(
            courseRepo.create({
              title: 'Credential Course',
              description: 'Course for credentials',
              level: 'beginner',
              status: 'published',
            }),
          );
        },
        'credential with id exists': async () => {
          const user = await userRepo.save(
            userRepo.create({
              email: 'credsid@test.com',
              passwordHash: await bcrypt.hash('Test@1234!', 10),
              username: 'credsiduser',
              role: 'student',
            }),
          );
          await courseRepo.save(
            courseRepo.create({
              title: 'Credential Course 2',
              description: 'Course for credential by id',
              level: 'beginner',
              status: 'published',
            }),
          );
        },

        // ── Wallet / Stellar ─────────────────────────
        'stellar account exists': async () => {
          // Stellar controller returns mock data; no DB setup needed
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should verify all pacts from consumers', async () => {
    // verifyProvider rejects on any mismatch, which fails the test and
    // causes Jest to exit non-zero so CI can gate merges.
    await expect(verifier.verifyProvider()).resolves.not.toThrow();
  });
});
