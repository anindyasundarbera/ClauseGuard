import { describe, expect, it } from "vitest";
import {
  classifyDocument,
  DOCUMENT_PROFILES,
  expandFieldOccurrences,
  runFieldDetectors,
} from "../../src/core/detection/documentProfiles.ts";
import { buildSamples } from "../../src/ui/samples.ts";
import { reviewHeading } from "../../src/ui/viewModel.ts";

// Made-up hospital form, laid out the way a PDF form comes out (one long line per row).
const FORM = [
  "CITY CARE HOSPITAL PRE-ANAESTHESIA CHECK-UP Page 3 of 5",
  "Patient Name : Mr Ravi Shankar Pal Age : 58 Years Gender : Male UHID : 99120000033417",
  "Consultant : Dr. Meera Dutta Gender : Female IP No : IP/26/004512",
  "DOB : 04/02/1968 Mobile No : +91 98300 12345",
  "Address : NANDIGRAM, EAST DISTRICT, NANDIGRAM,West Bengal,India,-700001 Ward : 4",
  "Diagnosis : BILATERAL INGUINAL HERNIA Plan Type : General anaesthesia",
  "Eosinophils 1.0 20.0-40.0 Monocytes 8.7 2.0-10.0 ECG : AF WITH INTERMITTENT CONDUCTION DEFECT",
  "Signed: Dr. Meera Dutta for Mr Ravi Shankar Pal",
].join(" ");

describe("Document type", () => {
  it("recognises a medical report, a contract, a bill and an unknown note", () => {
    expect(classifyDocument(FORM).profile.kind).toBe("MEDICAL");
    expect(
      classifyDocument(
        "MASTER SERVICES AGREEMENT. The parties agree that liability shall be capped. Clause 4 Termination. Governing law: Delaware."
      ).profile.kind
    ).toBe("CONTRACT");
    expect(
      classifyDocument("TAX INVOICE Invoice No: 2231 Qty 2 Sub-total 400 GST 72 Grand Total 472 Amount due in 15 days").profile.kind
    ).toBe("BILL");
    expect(classifyDocument("Shopping list: eggs, milk, bread.").profile.kind).toBe("GENERAL");
  });

  it("classifies the bundled samples sensibly", () => {
    const kinds = Object.fromEntries(
      (buildSamples() as Array<{ id: string; text: string }>).map((s) => [s.id, classifyDocument(s.text).profile.kind])
    );
    expect(kinds["sample-tenant-lease"]).toBe("CONTRACT");
    expect(["MEDICAL", "BILL"]).toContain(kinds["sample-medical-bill"]);
  });

  it("uses headings that fit the document", () => {
    const med = DOCUMENT_PROFILES.MEDICAL.headings;
    expect(reviewHeading("PERSON", 2, med)).toBe("Patients, doctors and relatives");
    expect(reviewHeading("ID_NUMBER", 2, med)).toBe("Patient and record numbers");
    expect(reviewHeading("PERSON", 2, DOCUMENT_PROFILES.CONTRACT.headings)).toBe("People and signatories");
    expect(reviewHeading("EMAIL", 2, med)).toBe("Email addresses");
    // Medical reports never get "project names" from the on-device AI.
    expect(DOCUMENT_PROFILES.MEDICAL.modelCategories.has("CODENAME")).toBe(false);
  });
});

describe("Label-anchored field patterns", () => {
  const fields = runFieldDetectors(FORM);
  const pick = (cat: string) => fields.filter((f) => f.category === cat).map((f) => `${f.fieldLabel}=${f.surface}`);

  it("reads each value up to the next label, never into it", () => {
    expect(pick("PERSON")).toEqual(["Patient Name=Mr Ravi Shankar Pal", "Consultant=Dr. Meera Dutta"]);
    expect(pick("ID_NUMBER")).toEqual(["UHID=99120000033417", "IP No=IP/26/004512"]);
    expect(pick("DATE_OF_BIRTH")).toEqual(["DOB=04/02/1968"]);
    expect(pick("PHONE")).toEqual(["Mobile No=+91 98300 12345"]);
    expect(pick("ADDRESS")).toEqual(["Address=NANDIGRAM, EAST DISTRICT, NANDIGRAM,West Bengal,India,-700001"]);
  });

  it("leaves clinical labels and values alone", () => {
    const surfaces = fields.map((f) => f.surface).join(" | ");
    for (const bad of ["Male", "Female", "BILATERAL", "General anaesthesia", "Eosinophils", "8.7", "AF WITH"]) {
      expect(surfaces).not.toContain(bad);
    }
  });

  it("stops at a line break or a table column", () => {
    const got = runFieldDetectors("Patient Name : Ravi Pal\nWard 4 Bed 2\tConsultant : Meera Dutta\tUnit 3");
    expect(got.map((f) => f.surface)).toEqual(["Ravi Pal", "Meera Dutta"]);
  });

  it("finds the other places a field value appears", () => {
    const more = expandFieldOccurrences(FORM, fields);
    const names = more.filter((m) => m.category === "PERSON").map((m) => m.surface).sort();
    expect(names).toEqual(["Dr. Meera Dutta", "Mr Ravi Shankar Pal"]);
  });
});
