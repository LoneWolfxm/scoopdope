/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://scoopdope.app',
  generateRobotsTxt: true,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: ['/', '/courses', '/courses/*', '/blog', '/blog/*', '/about', '/pricing', '/contact'],
        disallow: [
          '/admin',
          '/admin/*',
          '/api',
          '/api/*',
          '/dashboard',
          '/dashboard/*',
          '/profile',
          '/profile/*',
          '/instructor',
          '/instructor/*',
          '/auth',
          '/auth/*',
          '/login',
          '/register',
        ],
      },
    ],
  },
  exclude: [
    '/dashboard',
    '/dashboard/*',
    '/profile',
    '/profile/*',
    '/admin',
    '/admin/*',
    '/api',
    '/api/*',
    '/instructor',
    '/instructor/*',
    '/auth',
    '/auth/*',
    '/login',
    '/register',
    '/server-sitemap.xml',
  ],
  transform: async (config, path) => {
    const excludedPrefixes = [
      '/dashboard',
      '/profile',
      '/admin',
      '/api',
      '/instructor',
      '/auth',
      '/login',
      '/register',
    ];

    if (excludedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return null;
    }

    let priority = 0.7;
    let changefreq = 'daily';

    if (path === '/') {
      priority = 1;
    } else if (path === '/courses' || path === '/blog') {
      priority = 0.9;
    } else if (path.startsWith('/courses/')) {
      priority = 0.8;
    } else if (path.startsWith('/blog/')) {
      priority = 0.8;
    } else if (['/about', '/pricing', '/contact'].includes(path)) {
      priority = 0.6;
      changefreq = 'weekly';
    }

    return {
      loc: path,
      changefreq,
      priority,
      lastmod: new Date().toISOString(),
    };
  },
  additionalPaths: async (config) => {
    const result = [];
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    try {
      // Fetch all published courses
      const response = await fetch(`${apiUrl}/courses?limit=1000`);
      const { data: courses } = await response.json();

      // Add each course to sitemap
      if (courses && Array.isArray(courses)) {
        for (const course of courses) {
          result.push({
            loc: `/courses/${course.id}`,
            changefreq: 'daily',
            priority: 0.8,
            lastmod: course.updatedAt || new Date().toISOString(),
          });

          // Also try to fetch and add lessons if available
          try {
            const modulesRes = await fetch(`${apiUrl}/courses/${course.id}/modules`);
            const { data: modules } = await modulesRes.json();

            if (modules && Array.isArray(modules)) {
              for (const module of modules) {
                const lessonsRes = await fetch(`${apiUrl}/modules/${module.id}/lessons`);
                const { data: lessons } = await lessonsRes.json();

                if (lessons && Array.isArray(lessons)) {
                  for (const lesson of lessons) {
                    result.push({
                      loc: `/courses/${course.id}/lesson/${lesson.id}`,
                      changefreq: 'weekly',
                      priority: 0.7,
                      lastmod: lesson.updatedAt || new Date().toISOString(),
                    });
                  }
                }
              }
            }
          } catch (e) {
            // Ignore if modules/lessons fetch fails
          }
        }
      }
    } catch (e) {
      // Ignore if courses fetch fails
    }

    const excludedPrefixes = [
      '/dashboard',
      '/profile',
      '/admin',
      '/api',
      '/instructor',
      '/auth',
      '/login',
      '/register',
    ];

    return result.filter(
      (entry) =>
        !excludedPrefixes.some(
          (prefix) => entry.loc === prefix || entry.loc.startsWith(`${prefix}/`),
        ),
    );
  },
};
