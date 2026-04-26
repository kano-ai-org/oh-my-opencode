import { describe, expect, test } from "bun:test"
import { normalizeSessionID } from "./session-id"

describe("normalizeSessionID", () => {
  test("returns plain session ids unchanged", () => {
    expect(normalizeSessionID("ses_123")).toBe("ses_123")
  })

  test("extracts trailing session id from locator path", () => {
    expect(normalizeSessionID("RDpcX3dvcmtcX0hvcml6b25cSG9yaXpvblVJUGx1Z2luRGVtbw/session/ses_2541a9480ffeWYe03u5Jlznv4o")).toBe(
      "ses_2541a9480ffeWYe03u5Jlznv4o",
    )
  })

  test("keeps non-session values unchanged", () => {
    expect(normalizeSessionID("not-a-session")).toBe("not-a-session")
  })
})
