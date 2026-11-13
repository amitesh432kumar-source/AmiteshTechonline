import { youtubeFor } from './google.js';

export async function myChannel(auth) {
  const yt = youtubeFor(auth);
  const r = await yt.channels.list({ part: ['id', 'snippet', 'contentDetails'], mine: true });
  const c = r.data.items?.[0];
  return c && { id: c.id, title: c.snippet.title, uploads: c.contentDetails?.relatedPlaylists?.uploads };
}

// 1 unit. Channel ke saare videos ke naye top-level comments (sabse naye pehle)
export async function newThreads(auth, channelId, sinceIso) {
  const yt = youtubeFor(auth);
  const r = await yt.commentThreads.list({
    part: ['snippet', 'replies'],
    allThreadsRelatedToChannelId: channelId,
    order: 'time',
    maxResults: 50,
    textFormat: 'plainText'
  });
  const since = new Date(sinceIso).getTime();
  return (r.data.items || [])
    .filter((t) => new Date(t.snippet.topLevelComment.snippet.publishedAt).getTime() > since)
    .map((t) => {
      const top = t.snippet.topLevelComment;
      const s = top.snippet;
      const replies = t.replies?.comments || [];
      return {
        threadId: t.id,
        commentId: top.id,
        videoId: s.videoId || t.snippet.videoId,
        viewerName: s.authorDisplayName,
        viewerChannel: s.authorChannelId?.value,
        body: s.textDisplay || s.textOriginal || '',
        publishedAt: s.publishedAt,
        // channel owner ne pehle se reply kiya ho to dobara nahi
        ownerReplied: replies.some((c) => c.snippet.authorChannelId?.value === channelId),
        replyCount: t.snippet.totalReplyCount || 0
      };
    })
    .reverse(); // purane pehle
}

const titleCache = new Map();
export async function videoTitles(auth, ids) {
  const need = [...new Set(ids)].filter((i) => i && !titleCache.has(i));
  if (need.length) {
    const yt = youtubeFor(auth);
    const r = await yt.videos.list({ part: ['snippet'], id: need.slice(0, 50) });
    for (const v of r.data.items || []) titleCache.set(v.id, v.snippet.title);
    for (const i of need) if (!titleCache.has(i)) titleCache.set(i, '(unknown)');
  }
  return (id) => titleCache.get(id) || '(unknown)';
}

// 50 units
export async function replyTo(auth, parentId, text) {
  const yt = youtubeFor(auth);
  const r = await yt.comments.insert({ part: ['snippet'], requestBody: { snippet: { parentId, textOriginal: text } } });
  return r.data.id;
}
// 50 units. heldForReview = creator Studio me review kar sakta hai (delete nahi hota)
export async function holdForReview(auth, commentId) {
  await youtubeFor(auth).comments.setModerationStatus({ id: [commentId], moderationStatus: 'heldForReview' });
}

// ---------- Live chat ----------
export async function activeLiveChatId(auth) {
  const yt = youtubeFor(auth);
  const r = await yt.liveBroadcasts.list({ part: ['snippet', 'status'], broadcastStatus: 'active', broadcastType: 'all', mine: true });
  const b = r.data.items?.[0];
  return b ? { chatId: b.snippet.liveChatId, videoId: b.id, title: b.snippet.title } : null;
}
export async function chatMessages(auth, chatId, pageToken) {
  const yt = youtubeFor(auth);
  const r = await yt.liveChatMessages.list({ liveChatId: chatId, part: ['snippet', 'authorDetails'], pageToken, maxResults: 200 });
  return {
    next: r.data.nextPageToken,
    waitMs: r.data.pollingIntervalMillis || 10000,
    items: (r.data.items || [])
      .filter((m) => m.snippet.type === 'textMessageEvent')
      .map((m) => ({
        id: m.id,
        text: m.snippet.textMessageDetails?.messageText || '',
        authorId: m.authorDetails.channelId,
        authorName: m.authorDetails.displayName,
        isOwner: m.authorDetails.isChatOwner,
        isMod: m.authorDetails.isChatModerator
      }))
  };
}
export async function sendChat(auth, chatId, text) {
  await youtubeFor(auth).liveChatMessages.insert({
    part: ['snippet'],
    requestBody: { snippet: { liveChatId: chatId, type: 'textMessageEvent', textMessageDetails: { messageText: text.slice(0, 200) } } }
  });
}

// ---------- Weekly report data ----------
export async function recentUploadsWithStats(auth, uploadsPlaylist, days = 7) {
  const yt = youtubeFor(auth);
  const pl = await yt.playlistItems.list({ part: ['contentDetails', 'snippet'], playlistId: uploadsPlaylist, maxResults: 25 });
  const ids = (pl.data.items || []).map((i) => i.contentDetails.videoId);
  if (!ids.length) return [];
  const v = await yt.videos.list({ part: ['snippet', 'statistics'], id: ids });
  const cutoff = Date.now() - days * 864e5;
  return (v.data.items || []).map((x) => ({
    id: x.id,
    title: x.snippet.title,
    publishedAt: x.snippet.publishedAt,
    views: +x.statistics.viewCount || 0,
    likes: +x.statistics.likeCount || 0,
    comments: +x.statistics.commentCount || 0,
    isNewThisWeek: new Date(x.snippet.publishedAt).getTime() > cutoff
  }));
}
