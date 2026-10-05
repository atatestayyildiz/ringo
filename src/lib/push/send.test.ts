import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({ sendNotification: vi.fn(), setVapidDetails: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification, setVapidDetails } }));

const msg = { title: "t", body: "b", url: "/bugun", tag: "x" };
const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, p256dh: "k", auth: "a" });

beforeEach(() => {
  sendNotification.mockReset();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:a@b.c");
});

describe("sendToSubscriptions", () => {
  it("başarılı ve başarısız gönderimleri sayar, TTL ve urgency verir", async () => {
    const { sendToSubscriptions } = await import("./send");
    sendNotification.mockResolvedValueOnce({}).mockRejectedValueOnce({ statusCode: 500 }).mockResolvedValueOnce({});
    const res = await sendToSubscriptions([sub(1), sub(2), sub(3)], msg);
    expect(res).toMatchObject({ sent: 2, failed: 1 });
    expect(res.removed).toEqual([]);
    const [target, body, opts] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } });
    expect(JSON.parse(body)).toEqual(msg);
    expect(opts).toEqual({ TTL: 3600, urgency: "high" });
    expect(setVapidDetails).toHaveBeenCalledWith("mailto:a@b.c", "pub", "priv");
  });
  it("404 ve 410 silinecek listesine girer, başarısız sayılmaz", async () => {
    const { sendToSubscriptions } = await import("./send");
    sendNotification.mockRejectedValueOnce({ statusCode: 404 }).mockRejectedValueOnce({ statusCode: 410 }).mockResolvedValueOnce({});
    const res = await sendToSubscriptions([sub(1), sub(2), sub(3)], msg);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.removed.map((s) => s.endpoint).sort()).toEqual(["https://push.example/1", "https://push.example/2"]);
  });
  it("VAPID değişkenleri yoksa vapidConfigured false", async () => {
    const { vapidConfigured } = await import("./send");
    expect(vapidConfigured()).toBe(true);
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(vapidConfigured()).toBe(false);
  });
});
