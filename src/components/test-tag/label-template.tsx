"use client";

/**
 * Test tag label template for printing.
 * Dimensions: 89mm x 36mm (standard Avery label).
 * Uses CSS @media print for browser print dialog.
 */

interface LabelTemplateProps {
  testTagId: string;
  result: "PASS" | "FAIL";
  testDate: Date | string;
  nextDueDate: Date | string;
  testerName: string;
  companyName?: string;
}

export function LabelTemplate({
  testTagId,
  result,
  testDate,
  nextDueDate,
  testerName,
  companyName,
}: LabelTemplateProps) {
  const testDateStr = new Date(testDate).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const nextDueStr = new Date(nextDueDate).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .test-tag-label, .test-tag-label * { visibility: visible; }
          .test-tag-label {
            position: fixed;
            left: 0;
            top: 0;
            width: 89mm;
            height: 36mm;
          }
        }
      `}</style>
      <div
        className="test-tag-label inline-flex items-stretch border border-gray-300 rounded"
        style={{ width: "89mm", height: "36mm", fontFamily: "system-ui, sans-serif" }}
      >
        {/* QR code placeholder — using a text-based barcode representation */}
        <div className="flex items-center justify-center border-r border-gray-200 px-2" style={{ width: "30mm" }}>
          <div className="text-center">
            <div className="font-mono text-[10px] font-bold leading-tight break-all">
              {testTagId}
            </div>
            <div className="mt-1 border-t border-gray-200 pt-1">
              <svg viewBox="0 0 100 100" className="w-16 h-16">
                {/* Simple barcode-style lines */}
                {Array.from({ length: 20 }).map((_, i) => {
                  const charCode = testTagId.charCodeAt(i % testTagId.length) || 65;
                  const width = (charCode % 3) + 1;
                  return (
                    <rect
                      key={i}
                      x={i * 5}
                      y={0}
                      width={width}
                      height={100}
                      fill="black"
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        {/* Text block */}
        <div className="flex-1 flex flex-col justify-center px-2 py-1 text-[9px] leading-tight">
          <div className="font-bold text-[11px] font-mono">{testTagId}</div>
          <div
            className={`font-bold text-[12px] mt-0.5 ${
              result === "PASS" ? "text-green-700" : "text-red-700"
            }`}
          >
            {result}
          </div>
          <div className="mt-1 space-y-0.5 text-gray-600">
            <div>Tested: {testDateStr}</div>
            <div>Next due: {nextDueStr}</div>
            <div>By: {testerName}</div>
            {companyName && <div>{companyName}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
