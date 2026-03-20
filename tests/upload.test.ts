import { describe, it, expect } from 'vitest'
import {
  resolveMimeTypes,
  upload,
  buildUploadMiddleware,
  cleanupFiles,
} from '@forinda/kickjs-http'

describe('resolveMimeTypes', () => {
  it('maps short extensions to MIME types', () => {
    expect(resolveMimeTypes(['jpg'])).toEqual(['image/jpeg'])
    expect(resolveMimeTypes(['pdf'])).toEqual(['application/pdf'])
    expect(resolveMimeTypes(['png'])).toEqual(['image/png'])
    expect(resolveMimeTypes(['mp4'])).toEqual(['video/mp4'])
  })

  it('passes through full MIME types unchanged', () => {
    expect(resolveMimeTypes(['image/jpeg'])).toEqual(['image/jpeg'])
    expect(resolveMimeTypes(['application/pdf'])).toEqual(['application/pdf'])
  })

  it('passes through wildcards unchanged', () => {
    expect(resolveMimeTypes(['image/*'])).toEqual(['image/*'])
    expect(resolveMimeTypes(['application/*'])).toEqual(['application/*'])
  })

  it('handles leading dots', () => {
    expect(resolveMimeTypes(['.jpg'])).toEqual(['image/jpeg'])
    expect(resolveMimeTypes(['.png'])).toEqual(['image/png'])
    expect(resolveMimeTypes(['.pdf'])).toEqual(['application/pdf'])
  })

  it('is case insensitive', () => {
    expect(resolveMimeTypes(['JPG'])).toEqual(['image/jpeg'])
    expect(resolveMimeTypes(['PNG'])).toEqual(['image/png'])
    expect(resolveMimeTypes(['Pdf'])).toEqual(['application/pdf'])
  })

  it('passes unknown extensions through as-is', () => {
    expect(resolveMimeTypes(['xyz123'])).toEqual(['xyz123'])
    expect(resolveMimeTypes(['unknownext'])).toEqual(['unknownext'])
  })

  it('handles mixed input', () => {
    expect(resolveMimeTypes(['jpg', 'image/png', '.pdf', 'image/*'])).toEqual([
      'image/jpeg',
      'image/png',
      'application/pdf',
      'image/*',
    ])
  })
})

describe('upload.single()', () => {
  it('returns a function (middleware)', () => {
    const middleware = upload.single('avatar')
    expect(typeof middleware).toBe('function')
  })

  it('accepts custom options', () => {
    const middleware = upload.single('avatar', {
      maxSize: 2 * 1024 * 1024,
      allowedTypes: ['jpg', 'png'],
    })
    expect(typeof middleware).toBe('function')
  })
})

describe('upload.array()', () => {
  it('returns a function (middleware)', () => {
    const middleware = upload.array('photos')
    expect(typeof middleware).toBe('function')
  })

  it('accepts maxCount parameter', () => {
    const middleware = upload.array('photos', 5)
    expect(typeof middleware).toBe('function')
  })
})

describe('upload.none()', () => {
  it('returns a function (middleware)', () => {
    const middleware = upload.none()
    expect(typeof middleware).toBe('function')
  })
})

describe('buildUploadMiddleware', () => {
  it('builds middleware from config with mode single', () => {
    const middleware = buildUploadMiddleware({
      mode: 'single',
      fieldName: 'avatar',
    })
    expect(typeof middleware).toBe('function')
  })

  it('builds middleware from config with mode array', () => {
    const middleware = buildUploadMiddleware({
      mode: 'array',
      fieldName: 'photos',
      maxCount: 5,
    })
    expect(typeof middleware).toBe('function')
  })

  it('builds middleware from config with mode none', () => {
    const middleware = buildUploadMiddleware({ mode: 'none' })
    expect(typeof middleware).toBe('function')
  })

  it('passes allowedTypes through', () => {
    const middleware = buildUploadMiddleware({
      mode: 'single',
      fieldName: 'doc',
      allowedTypes: ['pdf', 'docx'],
    })
    expect(typeof middleware).toBe('function')
  })
})

describe('cleanupFiles', () => {
  it('returns a function (middleware)', () => {
    const middleware = cleanupFiles()
    expect(typeof middleware).toBe('function')
  })
})
