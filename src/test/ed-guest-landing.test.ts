import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(),"public/ed_master.html"),"utf8");

describe("public ED-ALL guest landing experience", () => {
  it("provides a public course landing surface with a guest welcome panel", () => {
    expect(html).toContain('id="mainPage" class="page active"');
    expect(html).toContain('id="guestWelcomePanel"');
    expect(html).toContain('id="coursesGrid"');
    expect(html).toContain('id="searchInput"');
  });

  it("offers sign-in/sign-up and public-course browsing actions to guests", () => {
    expect(html).toContain('id="guestStartBtn"');
    expect(html).toContain("onclick=\"showPage('loginPage')\"");
    expect(html).toContain('id="guestBrowseBtn"');
    expect(html).toContain("scrollIntoView({behavior:'smooth',block:'start'})");
  });

  it("shows the welcome panel only for signed-out visitors and hides it after authentication", () => {
    const start = html.indexOf("function updateUI()");
    const end = html.indexOf("function updateBreadcrumb",start);
    const update = html.slice(start,end);
    expect(update).toContain("guestWelcomePanel.style.display = 'block'");
    expect(update).toContain("guestWelcomePanel.style.display = 'none'");
    expect(update.indexOf("if (currentUser)")).toBeLessThan(update.indexOf("guestWelcomePanel.style.display = 'none'"));
  });

  it("provides Arabic and English guest landing copy", () => {
    expect(html).toContain("guestWelcomeTitle: 'ابدأ رحلتك التعليمية مع ED-ALL'");
    expect(html).toContain("guestWelcomeTitle: 'Start your learning journey with ED-ALL'");
    expect(html).toContain("'guestWelcomeTitle': t.guestWelcomeTitle");
    expect(html).toContain("'guestBrowseBtn': t.guestBrowseText");
  });

  it("does not require a student session just to load the public course catalogue", () => {
    expect(html).toContain("const isGuest = !currentUser");
    expect(html).toContain("loadAllCourseMetadata()");
    expect(html).toContain("isGuest ? Promise.resolve");
    expect(html).toContain("notifications");
    expect(html).toContain("Promise.resolve({ data: [], error: null })");
  });
});
