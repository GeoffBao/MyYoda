/**
 * 内置用户头像资源。
 *
 * 头像值以稳定的 builtin: 前缀保存到用户配置中，避免将带 hash 的打包资源
 * URL 写入配置文件；渲染时再解析为当前应用版本的本地资源。
 */

import AnalysingAvatar from '@/assets/avatars/185.Analysing.webp'
import ArtistAvatar from '@/assets/avatars/27.Artist.png.webp'
import AttachmentsAvatar from '@/assets/avatars/113.Attachments-1.png.webp'
import BodyBuildingAvatar from '@/assets/avatars/51.Body-building.png.webp'
import CheckAvatar from '@/assets/avatars/169.Check_.png.webp'
import CollaborationAvatar from '@/assets/avatars/195.Collaboration.webp'
import DealAvatar from '@/assets/avatars/55.Deal_.webp'
import ExploringGlobeAvatar from '@/assets/avatars/256.Exploring-The-Globe.png.webp'
import GlobalAvatar from '@/assets/avatars/118.Global.webp'
import HardWorkerAvatar from '@/assets/avatars/262.Hard-Worker.png.webp'
import IdeaAvatar from '@/assets/avatars/122.Idea_.png.webp'
import LearningAvatar from '@/assets/avatars/84.Learning.png.webp'
import LibraryAvatar from '@/assets/avatars/180.Library.png.webp'
import MoneyAvatar from '@/assets/avatars/167.Money_.png.webp'
import PhotographerAvatar from '@/assets/avatars/44.Photographer.webp'
import ProjectAvatar from '@/assets/avatars/174.Project.png.webp'
import PublicSpeakingAvatar from '@/assets/avatars/129.Public-speaking.png.webp'
import SavingsAvatar from '@/assets/avatars/92.Savings-1.png.webp'
import TargetAvatar from '@/assets/avatars/162.Target.png.webp'
import TodoListAvatar from '@/assets/avatars/259.To-Do-List.png.webp'
import TravelAvatar from '@/assets/avatars/12.Travel.png.webp'
import UniverseAvatar from '@/assets/avatars/260.Embracing-The-Universe.png.webp'
import WorkspaceAvatar from '@/assets/avatars/184.Workspace.webp'

export interface BuiltinAvatar {
  id: string
  label: string
  src: string
}

export const BUILTIN_AVATARS: BuiltinAvatar[] = [
  { id: 'builtin:check', label: '勾选', src: CheckAvatar },
  { id: 'builtin:analysing', label: '分析', src: AnalysingAvatar },
  { id: 'builtin:artist', label: '艺术家', src: ArtistAvatar },
  { id: 'builtin:attachments', label: '附件', src: AttachmentsAvatar },
  { id: 'builtin:body-building', label: '健身', src: BodyBuildingAvatar },
  { id: 'builtin:collaboration', label: '协作', src: CollaborationAvatar },
  { id: 'builtin:deal', label: '交易', src: DealAvatar },
  { id: 'builtin:exploring-globe', label: '探索世界', src: ExploringGlobeAvatar },
  { id: 'builtin:global', label: '全球', src: GlobalAvatar },
  { id: 'builtin:hard-worker', label: '努力工作', src: HardWorkerAvatar },
  { id: 'builtin:idea', label: '灵感', src: IdeaAvatar },
  { id: 'builtin:learning', label: '学习', src: LearningAvatar },
  { id: 'builtin:library', label: '图书馆', src: LibraryAvatar },
  { id: 'builtin:money', label: '金钱', src: MoneyAvatar },
  { id: 'builtin:photographer', label: '摄影师', src: PhotographerAvatar },
  { id: 'builtin:project', label: '项目', src: ProjectAvatar },
  { id: 'builtin:public-speaking', label: '演讲', src: PublicSpeakingAvatar },
  { id: 'builtin:savings', label: '储蓄', src: SavingsAvatar },
  { id: 'builtin:target', label: '目标', src: TargetAvatar },
  { id: 'builtin:todo-list', label: '待办事项', src: TodoListAvatar },
  { id: 'builtin:travel', label: '旅行', src: TravelAvatar },
  { id: 'builtin:universe', label: '拥抱宇宙', src: UniverseAvatar },
  { id: 'builtin:workspace', label: '工作区', src: WorkspaceAvatar },
]

export function getBuiltinAvatarSrc(avatar: string): string | undefined {
  return BUILTIN_AVATARS.find((item) => item.id === avatar)?.src
}
