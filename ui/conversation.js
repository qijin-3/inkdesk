export function conversation(doc) {
  doc.conversations ||= [];
  if (!doc.conversations.length)
    doc.conversations.push({
      id: crypto.randomUUID(),
      title: "新对话",
      messages: doc.chat || [],
    });
  let c =
    doc.conversations.find((c) => c.id === doc.activeConversationId) ||
    doc.conversations[0];
  doc.activeConversationId = c.id;
  return c;
}
