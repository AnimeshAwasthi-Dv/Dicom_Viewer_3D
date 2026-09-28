import type { DicomMetadata, DicomTag } from '../../types/dicom';
import { nameForTag } from './DicomParser';

/** A DICOM JSON object (PS3.18 F.2), as QIDO-RS and WADO-RS metadata return. */
export type DicomJson = Record<string, { vr?: string; Value?: unknown[]; BulkDataURI?: string; InlineBinary?: string }>;

function values(json: DicomJson, tag: string): unknown[] {
  return json[tag]?.Value ?? [];
}

export function jsonString(json: DicomJson, tag: string): string | undefined {
  const value = values(json, tag)[0];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && 'Alphabetic' in value) return String((value as { Alphabetic: string }).Alphabetic).replaceAll('^', ' ').trim() || undefined;
  const text = String(value).trim();
  return text || undefined;
}

export function jsonNumber(json: DicomJson, tag: string): number | undefined {
  const value = Number(values(json, tag)[0]);
  return values(json, tag).length && Number.isFinite(value) ? value : undefined;
}

function jsonNumbers(json: DicomJson, tag: string, length?: number): number[] | undefined {
  const numbers = values(json, tag).map(Number);
  if (!numbers.length || numbers.some((value) => !Number.isFinite(value))) return undefined;
  if (length !== undefined && numbers.length < length) return undefined;
  return length === undefined ? numbers : numbers.slice(0, length);
}

/** The summary the viewer indexes studies by, from one instance's WADO-RS metadata. */
export function dicomJsonToMetadata(json: DicomJson): DicomMetadata {
  const bitsAllocated = jsonNumber(json, '00280100') ?? 16;
  const centers = jsonNumbers(json, '00281050') ?? [];
  const widths = jsonNumbers(json, '00281051') ?? [];
  const explanations = values(json, '00281055').map((value) => String(value ?? '').trim());
  const voiPresets = centers.flatMap((center, index) => widths[index] >= 1 ? [{ center, width: widths[index], ...(explanations[index] ? { explanation: explanations[index] } : {}) }] : []);
  const frames = jsonNumber(json, '00280008') ?? 1;
  return {
    fileName: jsonString(json, '00080018') ?? 'instance',
    patientName: jsonString(json, '00100010'),
    patientId: jsonString(json, '00100020'),
    patientSex: jsonString(json, '00100040'),
    patientBirthDate: jsonString(json, '00100030'),
    patientAge: jsonString(json, '00101010'),
    bodyPartExamined: jsonString(json, '00180015'),
    studyDescription: jsonString(json, '00081030'),
    studyDate: jsonString(json, '00080020'),
    studyInstanceUID: jsonString(json, '0020000D') ?? '',
    seriesInstanceUID: jsonString(json, '0020000E') ?? '',
    sopInstanceUID: jsonString(json, '00080018') ?? '',
    seriesDescription: jsonString(json, '0008103E'),
    seriesNumber: jsonNumber(json, '00200011'),
    instanceNumber: jsonNumber(json, '00200013'),
    modality: jsonString(json, '00080060'),
    rows: jsonNumber(json, '00280010') ?? 0,
    columns: jsonNumber(json, '00280011') ?? 0,
    bitsAllocated,
    bitsStored: jsonNumber(json, '00280101') ?? bitsAllocated,
    pixelRepresentation: jsonNumber(json, '00280103') === 1 ? 1 : 0,
    photometricInterpretation: jsonString(json, '00280004') ?? 'MONOCHROME2',
    samplesPerPixel: jsonNumber(json, '00280002') ?? 1,
    planarConfiguration: jsonNumber(json, '00280006'),
    pixelSpacing: jsonNumbers(json, '00280030', 2) as [number, number] | undefined,
    sliceThickness: jsonNumber(json, '00180050'),
    spacingBetweenSlices: jsonNumber(json, '00180088'),
    imagePositionPatient: jsonNumbers(json, '00200032', 3) as [number, number, number] | undefined,
    imageOrientationPatient: jsonNumbers(json, '00200037', 6) as DicomMetadata['imageOrientationPatient'],
    frameOfReferenceUID: jsonString(json, '00200052'),
    windowCenter: centers[0],
    windowWidth: widths[0],
    ...(voiPresets.length ? { voiPresets } : {}),
    ...(frames > 1 ? { numberOfFrames: frames } : {}),
    rescaleSlope: jsonNumber(json, '00281053') ?? 1,
    rescaleIntercept: jsonNumber(json, '00281052') ?? 0,
    transferSyntaxUID: jsonString(json, '00020010') ?? ''
  };
}

function displayValue(element: DicomJson[string]): string {
  if (element.BulkDataURI) return '[Bulk data]';
  if (element.InlineBinary) return `[Binary data: ${Math.floor(element.InlineBinary.length * 0.75).toLocaleString()} bytes]`;
  if (!element.Value?.length) return '';
  if (element.vr === 'SQ') return `[Sequence: ${element.Value.length} item(s)]`;
  return element.Value.map((value) => {
    if (value && typeof value === 'object' && 'Alphabetic' in value) return String((value as { Alphabetic: string }).Alphabetic);
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }).join('\\');
}

/** Tags of a DICOM JSON object, in the shape the tags dialog lists. */
export function dicomJsonTags(json: DicomJson): DicomTag[] {
  return Object.entries(json)
    .filter(([tag]) => tag.toUpperCase() !== '7FE00010')
    .map(([tag, element]) => {
      const value = displayValue(element);
      return { tag: `(${tag.slice(0, 4).toUpperCase()},${tag.slice(4).toUpperCase()})`, name: nameForTag(tag), vr: element.vr, length: value.length, value };
    })
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
