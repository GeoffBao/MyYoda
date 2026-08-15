/**
 * 「发现」面板状态：官方流 / 视频下载 / 社区讨论
 */
import { atom } from 'jotai'
import type {
  DiscussionCategorySlug,
  DiscussionDetail,
  DiscussionListResult,
  DiscoverFeedItem,
  VideoDownloadState,
} from '@myyoda/shared'

/** 面板内 tab：featured 官方精选 / community 社区 / help 帮助 / feedback 反馈 */
export type DiscoverTab = 'featured' | 'community' | 'help' | 'feedback'
export const discoverTabAtom = atom<DiscoverTab>('featured')

/** 官方精选流 */
export const discoverFeedAtom = atom<DiscoverFeedItem[]>([])
export const discoverFeedLoadingAtom = atom(false)
export const discoverFeedErrorAtom = atom<string | null>(null)
/** 未读更新（侧边栏红点） */
export const discoverHasUnreadAtom = atom(false)
/** 数据源状态（是否离线缓存 + 缓存时间），用于离线横幅 */
export const discoverFeedSourceAtom = atom<{ fromCache: boolean; cachedAt?: number }>({
  fromCache: false,
})

/** 视频下载状态 Map（itemId -> 状态） */
export const videoDownloadStatesAtom = atom<Map<string, VideoDownloadState>>(new Map())

/** 社区讨论 */
export const discussionCategoryAtom = atom<DiscussionCategorySlug>('q-a')
export const discussionListResultAtom = atom<DiscussionListResult>({
  items: [],
  rateLimited: false,
  fromCache: false,
})
export const discussionListLoadingAtom = atom(false)
export const discussionDetailAtom = atom<DiscussionDetail | null>(null)
export const discussionDetailLoadingAtom = atom(false)
