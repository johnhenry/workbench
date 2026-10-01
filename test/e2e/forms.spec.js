import { test, expect, openApp, view } from "./fixtures.js";

const NOW = new Date("2026-06-15T12:00:00Z");

test.describe("forms: form-associated components in real forms", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
  });

  test("a required <kit--field> blocks submission, then the form submits through the components", async ({ page }) => {
    const notes = view(page, "notes");
    const form = notes.locator("form");
    const title = notes.locator('kit--field[name="title"]');
    const body = notes.locator('kit--area[name="body"]');

    // the components are real form controls: they are in form.elements and report validity
    const shape = await form.evaluate((f) => ({
      names: [...f.elements].map((e) => `${e.localName}:${e.name}`),
      titleValid: f.elements.title.checkValidity(),
    }));
    expect(shape.names).toEqual(["kit--field:title", "kit--area:body", "kit--submit-button:"]); // the button is a form element too
    expect(shape.titleValid).toBe(false); // required, empty

    // empty submit: refused by validation; nothing is added
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(notes.locator("wb--note-card")).toHaveCount(0);
    // validation focused the invalid control (the field delegates focus to its input; without that Firefox logs
    // "The invalid form control ... is not focusable" and focuses nothing)
    expect(await title.evaluate((el) => el.shadowRoot.delegatesFocus)).toBe(true);
    await expect(title).toBeFocused();
    await expect(title.locator("input")).toBeFocused();

    await title.locator("input").fill("Standup");
    await body.locator("textarea").fill("Discuss the import map.\nSecond line.");
    expect(await form.evaluate((f) => Object.fromEntries(new FormData(f)))).toEqual({ title: "Standup", body: "Discuss the import map.\nSecond line." });
    expect(await title.evaluate((el) => el.validity.valid)).toBe(true);

    await notes.getByRole("button", { name: "Add note" }).click();
    const card = notes.locator("wb--note-card");
    await expect(card).toHaveCount(1);
    await expect(card.locator("h3")).toHaveText("Standup");
    await expect(card.locator(".body")).toHaveText("Discuss the import map.\nSecond line.");
    // the form was reset through formResetCallback
    await expect(title.locator("input")).toHaveValue("");
    await expect(body.locator("textarea")).toHaveValue("");
  });

  test("Enter in a field submits the form, and the real submit-button component is the submitter (no app glue)", async ({ page }) => {
    const notes = view(page, "notes");
    const button = notes.locator("kit--submit-button");
    // html-modules' form-role="submit": a form-associated component that is the form's default button
    expect(await button.evaluate((el) => ({ type: el.type, form: el.form?.getAttribute("aria-label"), role: el.internals?.role ?? null }))).toMatchObject({ type: "submit", form: "New note" });
    // it adds nothing to FormData
    await notes.locator('kit--field[name="title"] input').fill("From the keyboard");
    expect(await notes.locator("form").evaluate((f) => [...new FormData(f).keys()])).toEqual(["title", "body"]);
    await notes.locator("form").evaluate((f) => {
      window.__submitters = [];
      f.addEventListener("submit", (e) => window.__submitters.push(e.submitter?.localName ?? null));
    });
    await notes.locator('kit--field[name="title"] input').press("Enter");
    await expect(notes.locator("wb--note-card h3")).toHaveText("From the keyboard");
    expect(await page.evaluate(() => window.__submitters)).toEqual(["kit--submit-button"]);
    // an empty required field: Enter is refused by validation, like a native form
    await notes.locator('kit--field[name="title"] input').press("Enter");
    await expect(notes.locator("wb--note-card")).toHaveCount(1);
  });

  test("the submit button works from the keyboard (Tab to it, Space) and is not a nested interactive control", async ({ page }) => {
    const tasks = view(page, "tasks");
    await tasks.locator('kit--field[name="label"] input').fill("By keyboard");
    await tasks.locator("kit--submit-button").focus();
    await page.keyboard.press("Space");
    await expect(tasks.locator("wb--task-item .label")).toHaveText("By keyboard");
    // its template holds a native <button>, so the host must not also be role=button (axe: nested-interactive)
    expect(await tasks.locator("kit--submit-button").evaluate((el) => el.internals?.role ?? null)).not.toBe("button");
  });

  test("the app has no form glue: nothing calls requestSubmit()", async ({ request }) => {
    for (const file of ["notes", "tasks", "settings"]) {
      const source = await (await request.get(`/app/tools/${file}.js`)).text();
      expect(source, file).not.toContain("requestSubmit");
    }
  });

  test("tasks: a text field and a date field, and the due date is formatted by dayjs from the CDN", async ({ page }) => {
    const tasks = view(page, "tasks");
    await tasks.locator('kit--field[name="label"] input').fill("Ship the workbench");
    await tasks.locator('kit--date-field[name="due"] input').fill("2026-06-20");
    await tasks.getByRole("button", { name: "Add task" }).click();
    const item = tasks.locator("wb--task-item");
    await expect(item).toHaveCount(1);
    await expect(item.locator(".label")).toHaveText("Ship the workbench");
    await expect(item.locator(".due")).toHaveText("Due in 5 days");
    await expect(item).not.toHaveAttribute("overdue");

    // an overdue task is flagged
    await tasks.locator('kit--field[name="label"] input').fill("Old task");
    await tasks.locator('kit--date-field[name="due"] input').fill("2026-06-01");
    await tasks.getByRole("button", { name: "Add task" }).click();
    const old = tasks.locator("wb--task-item").nth(1);
    await expect(old.locator(".due")).toHaveText("Due 14 days ago");
    await expect(old).toHaveAttribute("overdue", "");
  });

  test("settings: the profile form saves the owner and renames the page", async ({ page }) => {
    const settings = view(page, "settings");
    await settings.locator('kit--field[name="owner"] input').fill("Ada");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#app-title")).toHaveText("Ada's workbench");
    await expect(settings.locator(".hint")).toHaveText("Saved. Hello, Ada.");
  });
});
