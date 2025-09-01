import type { ChangeInfo, CommentInfo, MessageInfo } from '@/schemas/gerrit'
import { sanitizeCDATA, escapeXML } from '@/utils/shell-safety'

export const formatChangeAsXML = (change: ChangeInfo): string[] => {
  const lines: string[] = []
  lines.push(`  <change>`)
  lines.push(`    <id>${escapeXML(change.change_id)}</id>`)
  lines.push(`    <number>${change._number}</number>`)
  lines.push(`    <subject><![CDATA[${sanitizeCDATA(change.subject)}]]></subject>`)
  lines.push(`    <status>${escapeXML(change.status)}</status>`)
  lines.push(`    <project>${escapeXML(change.project)}</project>`)
  lines.push(`    <branch>${escapeXML(change.branch)}</branch>`)
  lines.push(`    <owner>`)
  if (change.owner?.name) {
    lines.push(`      <name><![CDATA[${sanitizeCDATA(change.owner.name)}]]></name>`)
  }
  if (change.owner?.email) {
    lines.push(`      <email>${escapeXML(change.owner.email)}</email>`)
  }
  lines.push(`    </owner>`)
  lines.push(`    <created>${escapeXML(change.created || '')}</created>`)
  lines.push(`    <updated>${escapeXML(change.updated || '')}</updated>`)
  lines.push(`  </change>`)
  return lines
}

export const formatCommentsAsXML = (comments: readonly CommentInfo[]): string[] => {
  const lines: string[] = []
  lines.push(`  <comments>`)
  lines.push(`    <count>${comments.length}</count>`)
  for (const comment of comments) {
    lines.push(`    <comment>`)
    if (comment.id) lines.push(`      <id>${escapeXML(comment.id)}</id>`)
    if (comment.path) {
      lines.push(`      <path><![CDATA[${sanitizeCDATA(comment.path)}]]></path>`)
    }
    if (comment.line) lines.push(`      <line>${comment.line}</line>`)
    if (comment.author?.name) {
      lines.push(`      <author><![CDATA[${sanitizeCDATA(comment.author.name)}]]></author>`)
    }
    if (comment.updated) lines.push(`      <updated>${escapeXML(comment.updated)}</updated>`)
    if (comment.message) {
      lines.push(`      <message><![CDATA[${sanitizeCDATA(comment.message)}]]></message>`)
    }
    if (comment.unresolved) lines.push(`      <unresolved>true</unresolved>`)
    lines.push(`    </comment>`)
  }
  lines.push(`  </comments>`)
  return lines
}

export const formatMessagesAsXML = (messages: readonly MessageInfo[]): string[] => {
  const lines: string[] = []
  lines.push(`  <messages>`)
  lines.push(`    <count>${messages.length}</count>`)
  for (const message of messages) {
    lines.push(`    <message>`)
    lines.push(`      <id>${escapeXML(message.id)}</id>`)
    if (message.author?.name) {
      lines.push(`      <author><![CDATA[${sanitizeCDATA(message.author.name)}]]></author>`)
    }
    if (message.author?._account_id) {
      lines.push(`      <author_id>${message.author._account_id}</author_id>`)
    }
    lines.push(`      <date>${escapeXML(message.date)}</date>`)
    if (message._revision_number) {
      lines.push(`      <revision>${message._revision_number}</revision>`)
    }
    if (message.tag) {
      lines.push(`      <tag>${escapeXML(message.tag)}</tag>`)
    }
    lines.push(`      <message><![CDATA[${sanitizeCDATA(message.message)}]]></message>`)
    lines.push(`    </message>`)
  }
  lines.push(`  </messages>`)
  return lines
}

export const flattenComments = (
  commentsMap: Record<string, readonly CommentInfo[]>,
): CommentInfo[] => {
  const comments: CommentInfo[] = []
  for (const [path, fileComments] of Object.entries(commentsMap)) {
    for (const comment of fileComments) {
      comments.push({ ...comment, path })
    }
  }
  return comments
}
