import type { RecordModel } from 'pocketbase'
import type { MutationDef, QueryDef } from '../pbHooks'
import type { PbDoc } from '../mapRecord'
import { pb } from '../pb'

export type ScanKind = 'image' | 'writing'

export type Scan = PbDoc<{
  text: string
  image: string
  kind: ScanKind
  collectionId: string
  collectionName: string
}>

export type ScanCreateArgs = {
  text: string
  image: File
  kind: ScanKind
}

export type ScanRemoveArgs = {
  id: string
}

export function scanImageUrl(scan: Scan) {
  return pb.files.getURL(scan as unknown as RecordModel, scan.image, { thumb: '200x0' })
}

export const scans: {
  list: QueryDef<void, Scan[]>
  create: MutationDef<ScanCreateArgs>
  remove: MutationDef<ScanRemoveArgs>
} = {
  list: {
    collection: 'scans',
    kind: 'list',
    sort: '-created',
  },
  create: {
    collection: 'scans',
    action: 'create',
    prepare: (args: ScanCreateArgs) => ({
      text: args.text,
      image: args.image,
      kind: args.kind,
    }),
  },
  remove: {
    collection: 'scans',
    action: 'delete',
    prepare: (args: ScanRemoveArgs) => ({ id: args.id }),
  },
}
