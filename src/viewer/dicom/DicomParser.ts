import dicomParser from 'dicom-parser';
import type { DicomTag, ParsedDicomFile } from '../../types/dicom';
import { extractMetadata, type DicomElementMap } from './MetadataExtractor';
import { TRANSFER_SYNTAX, isSupportedTransferSyntax } from './TransferSyntax';

const tagMap = {
  patientName: ['00100010', 'x00100010'],
  patientId: ['00100020', 'x00100020'],
  patientBirthDate: ['00100030', 'x00100030'],
  patientSex: ['00100040', 'x00100040'],
  patientAge: ['00101010', 'x00101010'],
  bodyPartExamined: ['00180015', 'x00180015'],
  studyDate: ['00080020', 'x00080020'],
  sopInstanceUID: ['00080018', 'x00080018'],
  modality: ['00080060', 'x00080060'],
  studyDescription: ['00081030', 'x00081030'],
  seriesDescription: ['0008103E', 'x0008103e'],
  studyInstanceUID: ['0020000D', 'x0020000d'],
  seriesInstanceUID: ['0020000E', 'x0020000e'],
  seriesNumber: ['00200011', 'x00200011'],
  instanceNumber: ['00200013', 'x00200013'],
  imagePositionPatient: ['00200032', 'x00200032'],
  imageOrientationPatient: ['00200037', 'x00200037'],
  frameOfReferenceUID: ['00200052', 'x00200052'],
  sliceThickness: ['00180050', 'x00180050'],
  spacingBetweenSlices: ['00180088', 'x00180088'],
  samplesPerPixel: ['00280002', 'x00280002'],
  photometricInterpretation: ['00280004', 'x00280004'],
  planarConfiguration: ['00280006', 'x00280006'],
  rows: ['00280010', 'x00280010'],
  columns: ['00280011', 'x00280011'],
  pixelSpacing: ['00280030', 'x00280030'],
  bitsAllocated: ['00280100', 'x00280100'],
  bitsStored: ['00280101', 'x00280101'],
  pixelRepresentation: ['00280103', 'x00280103'],
  windowCenter: ['00281050', 'x00281050'],
  windowWidth: ['00281051', 'x00281051'],
  rescaleIntercept: ['00281052', 'x00281052'],
  rescaleSlope: ['00281053', 'x00281053'],
  transferSyntaxUID: ['00020010', 'x00020010']
} as const;

const tagNames: Record<string, string> = {
  '00020000': 'File Meta Information Group Length',
  '00020001': 'File Meta Information Version',
  '00020002': 'Media Storage SOP Class UID',
  '00020003': 'Media Storage SOP Instance UID',
  '00020010': 'Transfer Syntax UID',
  '00020012': 'Implementation Class UID',
  '00020013': 'Implementation Version Name',
  '00080005': 'Specific Character Set',
  '00080008': 'Image Type',
  '00080012': 'Instance Creation Date',
  '00080013': 'Instance Creation Time',
  '00080016': 'SOP Class UID',
  '00080018': 'SOP Instance UID',
  '00080020': 'Study Date',
  '00080021': 'Series Date',
  '00080022': 'Acquisition Date',
  '00080023': 'Content Date',
  '00080030': 'Study Time',
  '00080031': 'Series Time',
  '00080032': 'Acquisition Time',
  '00080033': 'Content Time',
  '00080050': 'Accession Number',
  '00080054': 'Retrieve AE Title',
  '00080060': 'Modality',
  '00080070': 'Manufacturer',
  '00080080': 'Institution Name',
  '00080081': 'Institution Address',
  '00080090': 'Referring Physician Name',
  '00081010': 'Station Name',
  '00081030': 'Study Description',
  '0008103E': 'Series Description',
  '00081040': 'Institutional Department Name',
  '00081050': 'Performing Physician Name',
  '00081060': 'Name Of Physician Reading Study',
  '00081070': 'Operators Name',
  '00081090': 'Manufacturer Model Name',
  '00081140': 'Referenced Image Sequence',
  '00082111': 'Derivation Description',
  '00100010': 'Patient Name',
  '00100020': 'Patient ID',
  '00100030': 'Patient Birth Date',
  '00100040': 'Patient Sex',
  '00101000': 'Other Patient IDs',
  '00101010': 'Patient Age',
  '00101020': 'Patient Size',
  '00101030': 'Patient Weight',
  '00102160': 'Ethnic Group',
  '00104000': 'Patient Comments',
  '00180010': 'Contrast/Bolus Agent',
  '00180015': 'Body Part Examined',
  '00180022': 'Scan Options',
  '00180050': 'Slice Thickness',
  '00180060': 'KVP',
  '00180088': 'Spacing Between Slices',
  '00180090': 'Data Collection Diameter',
  '00181020': 'Software Versions',
  '00181030': 'Protocol Name',
  '00181100': 'Reconstruction Diameter',
  '00181110': 'Distance Source To Detector',
  '00181111': 'Distance Source To Patient',
  '00181120': 'Gantry/Detector Tilt',
  '00181130': 'Table Height',
  '00181140': 'Rotation Direction',
  '00181150': 'Exposure Time',
  '00181151': 'X-Ray Tube Current',
  '00181152': 'Exposure',
  '00181160': 'Filter Type',
  '00181170': 'Generator Power',
  '00181190': 'Focal Spot',
  '00181210': 'Convolution Kernel',
  '00185100': 'Patient Position',
  '00189302': 'Acquisition Type',
  '00189305': 'Revolution Time',
  '00189306': 'Single Collimation Width',
  '00189307': 'Total Collimation Width',
  '00189309': 'Table Speed',
  '00189310': 'Table Feed Per Rotation',
  '00189311': 'Spiral Pitch Factor',
  '00189345': 'CTDIvol',
  '0020000D': 'Study Instance UID',
  '0020000E': 'Series Instance UID',
  '00200010': 'Study ID',
  '00200011': 'Series Number',
  '00200013': 'Instance Number',
  '00200032': 'Image Position Patient',
  '00200037': 'Image Orientation Patient',
  '00200052': 'Frame Of Reference UID',
  '00201040': 'Position Reference Indicator',
  '00201041': 'Slice Location',
  '00201070': 'Other Study Numbers',
  '00201206': 'Number Of Study Related Series',
  '00201208': 'Number Of Study Related Instances',
  '00280002': 'Samples Per Pixel',
  '00280004': 'Photometric Interpretation',
  '00280006': 'Planar Configuration',
  '00280010': 'Rows',
  '00280011': 'Columns',
  '00280030': 'Pixel Spacing',
  '00280120': 'Pixel Padding Value',
  '00280100': 'Bits Allocated',
  '00280101': 'Bits Stored',
  '00280102': 'High Bit',
  '00280103': 'Pixel Representation',
  '00281050': 'Window Center',
  '00281051': 'Window Width',
  '00281052': 'Rescale Intercept',
  '00281053': 'Rescale Slope',
  '00281054': 'Rescale Type',
  '00281055': 'Window Center & Width Explanation',
  '00282110': 'Lossy Image Compression',
  '00282112': 'Lossy Image Compression Ratio',
  '00282114': 'Lossy Image Compression Method',
  '00321032': 'Requesting Physician',
  '00321033': 'Requesting Service',
  '00321060': 'Requested Procedure Description',
  '00400244': 'Performed Procedure Step Start Date',
  '00400245': 'Performed Procedure Step Start Time',
  '00400253': 'Performed Procedure Step ID',
  '00400254': 'Performed Procedure Step Description',
  '00400300': 'Total Time Of Fluoroscopy',
  '00400301': 'Total Number Of Exposures',
  '7005100D': 'Body Part Examined',
  '7FE00010': 'Pixel Data'
};

function addString(elements: DicomElementMap, dataSet: dicomParser.DataSet, targetTag: string, sourceTag: string): void {
  const value = dataSet.string(sourceTag);
  if (value !== undefined && value.trim() !== '') elements.set(targetTag, value);
}

function addInt(elements: DicomElementMap, dataSet: dicomParser.DataSet, targetTag: string, sourceTag: string): void {
  const value = dataSet.uint16(sourceTag) ?? dataSet.intString(sourceTag);
  if (value !== undefined) elements.set(targetTag, value);
}

// SeriesNumber and InstanceNumber are Integer Strings (text). Reading them as binary turns "1 " into 8241.
function addIntString(elements: DicomElementMap, dataSet: dicomParser.DataSet, targetTag: string, sourceTag: string): void {
  const value = dataSet.intString(sourceTag);
  if (value !== undefined && Number.isFinite(value)) elements.set(targetTag, value);
}

function addDecimalString(elements: DicomElementMap, dataSet: dicomParser.DataSet, targetTag: string, sourceTag: string): void {
  const count = dataSet.numStringValues(sourceTag) ?? 1;
  const values = Array.from({ length: count }, (_, index) => dataSet.floatString(sourceTag, index)).filter((value): value is number => value !== undefined);
  if (values.length === 1) elements.set(targetTag, values[0]);
  if (values.length > 1) elements.set(targetTag, values);
}

function toMetadataElements(dataSet: dicomParser.DataSet): DicomElementMap {
  const elements: DicomElementMap = new Map();
  addString(elements, dataSet, tagMap.patientName[0], tagMap.patientName[1]);
  addString(elements, dataSet, tagMap.patientId[0], tagMap.patientId[1]);
  addString(elements, dataSet, tagMap.patientBirthDate[0], tagMap.patientBirthDate[1]);
  addString(elements, dataSet, tagMap.patientSex[0], tagMap.patientSex[1]);
  addString(elements, dataSet, tagMap.patientAge[0], tagMap.patientAge[1]);
  addString(elements, dataSet, tagMap.bodyPartExamined[0], tagMap.bodyPartExamined[1]);
  addString(elements, dataSet, '7005100D', 'x7005100d');
  addString(elements, dataSet, tagMap.studyDate[0], tagMap.studyDate[1]);
  addString(elements, dataSet, tagMap.sopInstanceUID[0], tagMap.sopInstanceUID[1]);
  addString(elements, dataSet, tagMap.modality[0], tagMap.modality[1]);
  addString(elements, dataSet, tagMap.studyDescription[0], tagMap.studyDescription[1]);
  addString(elements, dataSet, tagMap.seriesDescription[0], tagMap.seriesDescription[1]);
  addString(elements, dataSet, tagMap.studyInstanceUID[0], tagMap.studyInstanceUID[1]);
  addString(elements, dataSet, tagMap.seriesInstanceUID[0], tagMap.seriesInstanceUID[1]);
  addString(elements, dataSet, tagMap.frameOfReferenceUID[0], tagMap.frameOfReferenceUID[1]);
  addString(elements, dataSet, tagMap.photometricInterpretation[0], tagMap.photometricInterpretation[1]);
  addString(elements, dataSet, tagMap.transferSyntaxUID[0], tagMap.transferSyntaxUID[1]);
  addIntString(elements, dataSet, tagMap.seriesNumber[0], tagMap.seriesNumber[1]);
  addIntString(elements, dataSet, tagMap.instanceNumber[0], tagMap.instanceNumber[1]);
  addInt(elements, dataSet, tagMap.samplesPerPixel[0], tagMap.samplesPerPixel[1]);
  addInt(elements, dataSet, tagMap.planarConfiguration[0], tagMap.planarConfiguration[1]);
  addInt(elements, dataSet, tagMap.rows[0], tagMap.rows[1]);
  addInt(elements, dataSet, tagMap.columns[0], tagMap.columns[1]);
  addInt(elements, dataSet, tagMap.bitsAllocated[0], tagMap.bitsAllocated[1]);
  addInt(elements, dataSet, tagMap.bitsStored[0], tagMap.bitsStored[1]);
  addInt(elements, dataSet, tagMap.pixelRepresentation[0], tagMap.pixelRepresentation[1]);
  addDecimalString(elements, dataSet, tagMap.imagePositionPatient[0], tagMap.imagePositionPatient[1]);
  addDecimalString(elements, dataSet, tagMap.imageOrientationPatient[0], tagMap.imageOrientationPatient[1]);
  addDecimalString(elements, dataSet, tagMap.sliceThickness[0], tagMap.sliceThickness[1]);
  addDecimalString(elements, dataSet, tagMap.spacingBetweenSlices[0], tagMap.spacingBetweenSlices[1]);
  addDecimalString(elements, dataSet, tagMap.pixelSpacing[0], tagMap.pixelSpacing[1]);
  addDecimalString(elements, dataSet, tagMap.windowCenter[0], tagMap.windowCenter[1]);
  addDecimalString(elements, dataSet, tagMap.windowWidth[0], tagMap.windowWidth[1]);
  addString(elements, dataSet, '00281055', 'x00281055');
  addIntString(elements, dataSet, '00280008', 'x00280008');
  addDecimalString(elements, dataSet, tagMap.rescaleIntercept[0], tagMap.rescaleIntercept[1]);
  addDecimalString(elements, dataSet, tagMap.rescaleSlope[0], tagMap.rescaleSlope[1]);
  return elements;
}

function normalizeTag(tag: string): string {
  return tag.startsWith('x') ? tag.slice(1).toUpperCase() : tag.toUpperCase();
}

function tagLabel(tag: string): string {
  const normalized = normalizeTag(tag);
  return `(${normalized.slice(0, 4)},${normalized.slice(4)})`;
}

/** Standard name of a tag given as `x00100010`, `00100010` or with separators stripped. */
export function nameForTag(key: string): string {
  const normalized = normalizeTag(key);
  if (tagNames[normalized]) return tagNames[normalized];
  if (key === 'xfffee000') return 'Item';
  if (key === 'xfffee00d') return 'Item Delimitation Item';
  if (key === 'xfffee0dd') return 'Sequence Delimitation Item';
  return dicomParser.isPrivateTag(key) ? 'Private Tag' : 'Unknown Standard Tag';
}

function elementValue(dataSet: dicomParser.DataSet, element: dicomParser.Element, tag: string): string {
  if (tag === 'x7fe00010') return `[PixelData: ${element.length.toLocaleString()} bytes]`;
  if (element.items || element.dataSet) return `[Sequence: ${element.items?.length ?? 1} item(s)]`;
  if (element.length <= 0) return '';
  if (element.length > 2048) return `[Binary data: ${element.length.toLocaleString()} bytes]`;
  try {
    const value = dicomParser.explicitElementToString(dataSet, element).trim();
    if (value) return value;
  } catch {
    // Fall through to best-effort string decoding for implicit VR datasets.
  }
  try {
    const value = dataSet.string(tag)?.trim();
    if (value) return value;
  } catch {
    return `[Unreadable value: ${element.length.toLocaleString()} bytes]`;
  }
  return `[${element.length.toLocaleString()} bytes]`;
}

/** Every element of a parsed file except pixel data, for display. */
export function extractRawTags(dataSet: dicomParser.DataSet): DicomTag[] {
  return Object.entries(dataSet.elements)
    .map(([key, element]) => {
      return {
        tag: tagLabel(key),
        name: nameForTag(key),
        vr: element.vr,
        length: element.length,
        value: elementValue(dataSet, element, key)
      };
    })
    .filter((tag) => tag.name !== 'Pixel Data')
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

function sliceByteArray(byteArray: dicomParser.ByteArray, offset: number, length: number): ArrayBuffer {
  const view = byteArray instanceof Uint8Array ? byteArray : new Uint8Array(byteArray);
  return Uint8Array.from(view.subarray(offset, offset + length)).buffer;
}

export interface ParseOptions {
  /** Copy the (first frame's) pixel data out of the file. Header-only callers skip the copy. Default true. */
  pixelData?: boolean;
}

export class DicomParser {
  parse(buffer: ArrayBuffer, fileName = 'local.dcm', options: ParseOptions = {}): ParsedDicomFile {
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer), { TransferSyntaxUID: TRANSFER_SYNTAX.implicitLittleEndian });
    const elements = toMetadataElements(dataSet);
    const transferSyntaxUID = String(elements.get('00020010') ?? TRANSFER_SYNTAX.implicitLittleEndian).trim();
    const pixelDataElement = dataSet.elements.x7fe00010;
    const metadata = extractMetadata(
      elements,
      fileName,
      transferSyntaxUID,
      pixelDataElement ? { offset: pixelDataElement.dataOffset, length: pixelDataElement.length } : undefined
    );
    metadata.rawTags = extractRawTags(dataSet);

    if (!pixelDataElement) return { metadata, error: 'Missing PixelData element.' };
    if (!isSupportedTransferSyntax(transferSyntaxUID)) return { metadata, error: `Unsupported transfer syntax: ${transferSyntaxUID}` };
    if (options.pixelData === false) return { metadata };
    if (pixelDataElement.encapsulatedPixelData) {
      const frame = dicomParser.readEncapsulatedPixelData(dataSet, pixelDataElement, 0);
      return { metadata, pixelData: sliceByteArray(frame, 0, frame.byteLength) };
    }
    return { metadata, pixelData: sliceByteArray(dataSet.byteArray, pixelDataElement.dataOffset, pixelDataElement.length) };
  }
}
