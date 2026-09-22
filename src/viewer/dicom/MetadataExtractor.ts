import type { DicomMetadata } from '../../types/dicom';

export type DicomElementValue = string | number | number[] | undefined;
export type DicomElementMap = Map<string, DicomElementValue>;

const getString = (map: DicomElementMap, tag: string): string | undefined => {
  const value = map.get(tag);
  return typeof value === 'string' && value.trim() ? value.trim().replaceAll('^', ' ') : undefined;
};

const getNumber = (map: DicomElementMap, tag: string): number | undefined => {
  const value = map.get(tag);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value.split('\\')[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const getNumbers = <T extends number>(map: DicomElementMap, tag: string, length: T): number[] | undefined => {
  const value = map.get(tag);
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split('\\').map(Number)
      : undefined;
  if (!values || values.length < length || values.some((item) => !Number.isFinite(item))) return undefined;
  return values.slice(0, length);
};

export interface PixelDataLocation {
  offset: number;
  length: number;
}

export function extractMetadata(
  elements: DicomElementMap,
  fileName: string,
  transferSyntaxUID: string,
  pixelData?: PixelDataLocation
): DicomMetadata {
  const rows = getNumber(elements, '00280010') ?? 0;
  const columns = getNumber(elements, '00280011') ?? 0;
  const bitsAllocated = getNumber(elements, '00280100') ?? 16;
  const bitsStored = getNumber(elements, '00280101') ?? bitsAllocated;
  const pixelRepresentation = (getNumber(elements, '00280103') ?? 0) === 1 ? 1 : 0;
  const spacing = getNumbers(elements, '00280030', 2);
  const ipp = getNumbers(elements, '00200032', 3);
  const iop = getNumbers(elements, '00200037', 6);

  return {
    fileName,
    patientName: getString(elements, '00100010'),
    patientId: getString(elements, '00100020'),
    patientSex: getString(elements, '00100040'),
    patientBirthDate: getString(elements, '00100030'),
    patientAge: getString(elements, '00101010'),
    bodyPartExamined: getString(elements, '00180015') ?? getString(elements, '7005100D'),
    studyDescription: getString(elements, '00081030'),
    studyDate: getString(elements, '00080020'),
    studyInstanceUID: getString(elements, '0020000D') ?? crypto.randomUUID(),
    seriesInstanceUID: getString(elements, '0020000E') ?? crypto.randomUUID(),
    sopInstanceUID: getString(elements, '00080018') ?? crypto.randomUUID(),
    seriesDescription: getString(elements, '0008103E'),
    seriesNumber: getNumber(elements, '00200011'),
    instanceNumber: getNumber(elements, '00200013'),
    modality: getString(elements, '00080060'),
    rows,
    columns,
    bitsAllocated,
    bitsStored,
    pixelRepresentation,
    photometricInterpretation: getString(elements, '00280004') ?? 'MONOCHROME2',
    samplesPerPixel: getNumber(elements, '00280002') ?? 1,
    planarConfiguration: getNumber(elements, '00280006'),
    pixelSpacing: spacing as [number, number] | undefined,
    sliceThickness: getNumber(elements, '00180050'),
    spacingBetweenSlices: getNumber(elements, '00180088'),
    imagePositionPatient: ipp as [number, number, number] | undefined,
    imageOrientationPatient: iop as [number, number, number, number, number, number] | undefined,
    frameOfReferenceUID: getString(elements, '00200052'),
    windowCenter: getNumber(elements, '00281050'),
    windowWidth: getNumber(elements, '00281051'),
    rescaleSlope: getNumber(elements, '00281053') ?? 1,
    rescaleIntercept: getNumber(elements, '00281052') ?? 0,
    transferSyntaxUID,
    pixelDataOffset: pixelData?.offset,
    pixelDataLength: pixelData?.length
  };
}
