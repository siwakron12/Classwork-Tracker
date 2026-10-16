import { Elysia } from "elysia";
import { google } from "googleapis";

// ใช้ส่วนตัวคนเดียว -> ใช้ oauth client ตัวเดียวได้เลย
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI!,
);

const classroom = google.classroom({ version: "v1", auth: oauth2Client });

const scopes = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
];

// รายวิชาที่สร้างในปีปัจจุบัน
async function getCourses() {
  const res = await classroom.courses.list({
    pageSize: 100,
    courseStates: ["ACTIVE"],
  });
  const year = new Date().getFullYear();
  return (res.data.courses ?? []).filter(
    (c) => c.creationTime && new Date(c.creationTime).getFullYear() === year,
  );
}

// งานที่ยังไม่ส่ง (NEW / CREATED / RECLAIMED_BY_STUDENT)
async function getWorkNow(
  courses: { id?: string | null; name?: string | null }[],
) {
  const result = [];

  for (const course of courses) {
    // 1. งานทั้งหมดในวิชา
    const workRes = await classroom.courses.courseWork.list({
      courseId: course.id!,
    });

    const allWork = workRes.data.courseWork ?? [];

    // 2. สถานะงานของเรา เอาเฉพาะที่ยังไม่ส่ง
    const subRes = await classroom.courses.courseWork.studentSubmissions.list({
      courseId: course.id!,
      courseWorkId: "-",
      userId: "me",
      states: ["NEW", "CREATED", "RECLAIMED_BY_STUDENT"],
    });
    const notSubmitted = subRes.data.studentSubmissions ?? [];

    // 3. จับคู่ว่างานที่ยังไม่ส่ง คืองานไหน
    for (const sub of notSubmitted) {
      const work = allWork.find((w) => w.id === sub.courseWorkId);

      result.push({
        course: course.name,
        title: work?.title,
        description: work?.description,
        dueDate: work?.dueDate,
        materials: work?.materials,
        link: work?.alternateLink,
      });
    }
  }

  return result;
}

const app = new Elysia()
  // 1. เริ่ม Login
  .get("/auth/google", ({ set }) => {
    set.status = 302;
    set.headers.location = oauth2Client.generateAuthUrl({
      access_type: "online",
      scope: scopes,
    });
    return "";
  })

  .get("/auth/google/callback", async ({ query, set }) => {
    const code = query.code as string | undefined;
    if (!code) {
      set.status = 400;
      return { error: "Missing authorization code" };
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      set.status = 302;
      set.headers.location = "/api/get-work-now";
      return "";
    } catch (err) {
      console.error(err);
      set.status = 400;
      return { error: "Login failed -> ไปที่ /auth/google ใหม่" };
    }
  })
  // 2. Google ส่ง code กลับมา -> แสดงรายวิชา + งานที่ยังไม่ส่ง
  .post("/api/get-work-now", async ({ body, set }) => {
    const { courses } = body as {
      courses: { id: string; name?: string }[];
    };

    if (!courses || courses.length === 0) {
      set.status = 400;
      return { error: "ต้องส่ง courses มาด้วย" };
    }

    try {
      const work = await getWorkNow(courses);
      return { work };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: "Failed to get Classroom data" };
    }
  })

  .get("/api/get-courses-now", async ({ query, set }) => {
    try {
      const courses = await getCourses();
      return { courses };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: "Failed to get Classroom data" };
    }
  })

  .listen(3000);

console.log(`Server running at http://localhost:${app.server?.port}`);
