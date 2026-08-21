import { describe, expect, test } from 'bun:test'
import { NOTIFICATION_SOUND_PACK_IDS, getEffectiveSoundPackId } from './notification-sound-selection'

describe('getEffectiveSoundPackId', () => {
  test('新版 UISFX pack id 原样透传', () => {
    for (const packId of NOTIFICATION_SOUND_PACK_IDS) {
      expect(getEffectiveSoundPackId(packId)).toBe(packId)
    }
  })

  test('旧版通知音 id 映射到对应新 pack（8 个旧 id 全覆盖）', () => {
    expect(getEffectiveSoundPackId('ding')).toBe('minimal')
    expect(getEffectiveSoundPackId('ding-dong')).toBe('soft')
    expect(getEffectiveSoundPackId('discord')).toBe('arcade')
    expect(getEffectiveSoundPackId('done')).toBe('studio')
    expect(getEffectiveSoundPackId('down-power')).toBe('mechanical')
    expect(getEffectiveSoundPackId('food')).toBe('organic')
    expect(getEffectiveSoundPackId('lite')).toBe('glass')
    expect(getEffectiveSoundPackId('quiet')).toBe('zen')
  })

  test('undefined 或未知 id 兜底为 minimal', () => {
    expect(getEffectiveSoundPackId(undefined)).toBe('minimal')
    expect(getEffectiveSoundPackId('none' as never)).toBe('minimal')
  })

  test('NOTIFICATION_SOUND_PACK_IDS 恰好覆盖 12 个 UISFX feel，无重复', () => {
    expect(NOTIFICATION_SOUND_PACK_IDS.length).toBe(12)
    expect(new Set(NOTIFICATION_SOUND_PACK_IDS).size).toBe(12)
  })
})
