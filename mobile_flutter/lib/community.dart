part of 'main.dart';

class BoardPage extends StatefulWidget {
  final AppState m;
  final bool inquiry;
  const BoardPage(this.m, {super.key, this.inquiry = false});
  @override
  State<BoardPage> createState() => _BoardPageState();
}

class _BoardPageState extends State<BoardPage> {
  String filter = '전체';
  @override
  Widget build(BuildContext c) {
    final m = widget.m;
    final all = m.posts
        .where((p) => p['kind'] == (widget.inquiry ? 'inquiry' : 'public'))
        .toList();
    final posts = all
        .where(
          (p) =>
              filter == '전체' ||
              (widget.inquiry
                  ? (filter == '대기 중'
                        ? p['status'] != 'answered'
                        : p['status'] == 'answered')
                  : p['category'] == filter),
        )
        .toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 10, 24, 20),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.inquiry ? (m.staff ? '운영진 문의함' : '내 문의') : '게시판',
                  style: const TextStyle(
                    fontSize: 25,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -.7,
                  ),
                ),
              ),
              FilledButton.tonalIcon(
                onPressed: () => open(c, PostForm(m, inquiry: widget.inquiry)),
                icon: const Icon(Icons.add, size: 18),
                label: Text(widget.inquiry ? '문의' : '글쓰기'),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final category
                    in widget.inquiry
                        ? ['전체', '대기 중', '답변 완료']
                        : ['전체', '자유', '스터디', '공용물품'])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(category),
                      selected: filter == category,
                      showCheckmark: false,
                      onSelected: (_) => setState(() => filter = category),
                    ),
                  ),
              ],
            ),
          ),
        ),
        gap(12),
        Expanded(
          child: RefreshIndicator(
            onRefresh: m.refresh,
            child: posts.isEmpty
                ? ListView(
                    padding: const EdgeInsets.all(32),
                    children: [
                      gap(75),
                      const Icon(
                        Icons.chat_bubble_outline_rounded,
                        size: 35,
                        color: muted,
                      ),
                      gap(20),
                      Text(
                        widget.inquiry ? '아직 문의가 없습니다.' : '아직 게시글이 없습니다.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      gap(10),
                      Text(
                        widget.inquiry
                            ? '보낸 문의와 운영진의 답변이 여기에 표시됩니다.'
                            : '동아리원과 나누고 싶은 이야기를 남겨주세요.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: muted,
                          fontSize: 13,
                          height: 1.7,
                        ),
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    itemCount: posts.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (c, i) {
                      final p = posts[i];
                      return InkWell(
                        onTap: () => open(c, PostDetail(m, p['id'])),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.inquiry
                                    ? (p['status'] == 'answered'
                                          ? '답변 완료'
                                          : '대기 중')
                                    : p['category'],
                                style: TextStyle(
                                  fontSize: 11,
                                  color: Theme.of(c).colorScheme.secondary,
                                ),
                              ),
                              gap(8),
                              Text(
                                p['title'],
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w700,
                                  height: 1.5,
                                ),
                              ),
                              gap(8),
                              note(
                                '${widget.inquiry ? (p['authorName'] ?? '나') : '익명'} · 댓글 ${p['comments'].length}',
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ),
        if (widget.inquiry)
          Padding(
            padding: const EdgeInsets.all(16),
            child: note('작성자와 운영진만 내용을 확인할 수 있습니다.'),
          ),
      ],
    );
  }
}

Future<bool> communityConsent(BuildContext c, AppState m) async {
  if (m.data?['communityAccepted'] == true) return true;
  final yes = await confirm(
    c,
    '커뮤니티 이용 수칙',
    '욕설·괴롭힘, 음란·폭력 콘텐츠, 개인정보 공개, 스팸을 게시할 수 없습니다. 신고된 내용은 운영진이 검토하고 삭제할 수 있습니다. 게시글과 댓글의 작성자를 차단할 수 있습니다.',
    action: '동의하고 계속',
  );
  if (!yes) return false;
  await m.mutate('/me/community-consent', body: {'version': policyVersion});
  return true;
}

class PostForm extends StatefulWidget {
  final AppState m;
  final bool inquiry;
  final Json? post;
  const PostForm(this.m, {super.key, this.inquiry = false, this.post});
  @override
  State<PostForm> createState() => _PostFormState();
}

class _PostFormState extends State<PostForm> {
  late TextEditingController title, body;
  late String category;
  final form = GlobalKey<FormState>();
  @override
  void initState() {
    super.initState();
    title = TextEditingController(text: widget.post?['title'] ?? '');
    body = TextEditingController(text: widget.post?['body'] ?? '');
    category = widget.post?['category'] ?? (widget.inquiry ? '문의' : '자유');
  }

  @override
  void dispose() {
    title.dispose();
    body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Sheet(
    widget.post != null
        ? '글 수정'
        : widget.inquiry
        ? '운영진에게 문의'
        : '글쓰기',
    [
      Form(
        key: form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              initialValue: category,
              decoration: const InputDecoration(labelText: '분류'),
              items: [
                for (final value
                    in widget.inquiry ? ['문의', '건의'] : ['자유', '스터디', '공용물품'])
                  DropdownMenuItem(value: value, child: Text(value)),
              ],
              onChanged: (v) => category = v!,
            ),
            gap(20),
            TextFormField(
              controller: title,
              maxLength: 60,
              minLines: 1,
              maxLines: 3,
              decoration: const InputDecoration(labelText: '제목'),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? '제목을 입력해주세요.' : null,
            ),
            gap(10),
            TextFormField(
              controller: body,
              maxLength: 2000,
              minLines: 8,
              maxLines: 20,
              decoration: const InputDecoration(
                labelText: '내용',
                alignLabelWithHint: true,
              ),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? '내용을 입력해주세요.' : null,
            ),
            gap(12),
            note(
              widget.inquiry
                  ? '이름과 문의 내용은 운영진에게만 전달됩니다.'
                  : '동아리 회원에게 익명으로 공개됩니다.',
            ),
            gap(24),
            ActionButton(
              widget.post != null
                  ? '수정 내용 저장'
                  : widget.inquiry
                  ? '문의 보내기'
                  : '글 등록',
              () async {
                if (!form.currentState!.validate()) return;
                if (!widget.inquiry && !await communityConsent(c, widget.m)) {
                  return;
                }
                await widget.m.mutate(
                  widget.post == null
                      ? '/posts'
                      : '/posts/${widget.post!['id']}',
                  method: widget.post == null ? 'POST' : 'PATCH',
                  body: {
                    'roomId': 'sai-room',
                    'kind': widget.inquiry ? 'inquiry' : 'public',
                    'category': category,
                    'title': title.text.trim(),
                    'body': body.text.trim(),
                  },
                );
                if (c.mounted) Navigator.pop(c);
              },
            ),
          ],
        ),
      ),
    ],
  );
}

class PostDetail extends StatefulWidget {
  final AppState m;
  final String id;
  const PostDetail(this.m, this.id, {super.key});
  @override
  State<PostDetail> createState() => _PostDetailState();
}

class _PostDetailState extends State<PostDetail> {
  final reply = TextEditingController();
  @override
  void dispose() {
    reply.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => ListenableBuilder(
    listenable: widget.m,
    builder: (c, _) {
      final m = widget.m;
      final matches = m.posts.where((p) => p['id'] == widget.id);
      if (matches.isEmpty) return Sheet('게시글', [note('삭제되었거나 표시할 수 없는 글입니다.')]);
      final p = matches.first;
      final inquiry = p['kind'] == 'inquiry';
      return Sheet(inquiry ? '문의' : '게시글', [
        Row(
          children: [
            Text(
              p['category'],
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(c).colorScheme.secondary,
              ),
            ),
            const Spacer(),
            if (p['owner'] == 'me')
              PopupMenuButton<String>(
                tooltip: '게시글 관리',
                onSelected: (v) async {
                  if (v == 'edit') {
                    open(c, PostForm(m, post: p, inquiry: inquiry));
                  } else if (await confirm(
                    c,
                    '글을 삭제할까요?',
                    '댓글도 함께 삭제됩니다.',
                    action: '삭제',
                  )) {
                    try {
                      await m.mutate('/posts/${p['id']}', method: 'DELETE');
                      if (c.mounted) Navigator.pop(c);
                    } catch (e) {
                      if (c.mounted) message(c, e);
                    }
                  }
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('수정')),
                  PopupMenuItem(value: 'delete', child: Text('삭제')),
                ],
              ),
            if (!inquiry && p['owner'] != 'me') SafetyMenu(m, 'post', p['id']),
          ],
        ),
        gap(8),
        Text(
          p['title'],
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w700,
            height: 1.45,
            letterSpacing: -.6,
          ),
        ),
        gap(10),
        note(
          inquiry
              ? (p['authorName'] ?? '회원')
              : '익명${p['owner'] == 'me' ? ' · 나' : ''}',
        ),
        gap(28),
        SelectableText(
          p['body'],
          style: const TextStyle(fontSize: 16, height: 1.8),
        ),
        gap(32),
        const Divider(),
        section(inquiry ? '대화' : '댓글 ${p['comments'].length}'),
        for (final comment in p['comments'])
          Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      comment['owner'] == 'admin'
                          ? 'SAI 운영진'
                          : comment['owner'] == 'me'
                          ? '나'
                          : '익명',
                      style: const TextStyle(fontSize: 12, color: muted),
                    ),
                    const Spacer(),
                    if (!inquiry &&
                        comment['owner'] != 'me' &&
                        comment['isSelf'] != true)
                      SafetyMenu(m, 'comment', comment['id']),
                  ],
                ),
                Text(
                  comment['body'],
                  style: const TextStyle(fontSize: 14, height: 1.7),
                ),
              ],
            ),
          ),
        gap(8),
        TextField(
          controller: reply,
          minLines: 2,
          maxLines: 6,
          maxLength: 500,
          decoration: InputDecoration(
            hintText: inquiry && m.staff ? '운영진 답변을 남겨주세요' : '댓글을 입력해주세요',
          ),
        ),
        gap(8),
        ActionButton(inquiry && m.staff ? '답변 보내기' : '등록', () async {
          if (reply.text.trim().isEmpty) return;
          if (!inquiry && !await communityConsent(c, m)) return;
          await m.mutate(
            '/posts/${p['id']}/${inquiry && m.staff ? 'reply' : 'comments'}',
            body: {'body': reply.text.trim()},
          );
          reply.clear();
        }),
      ]);
    },
  );
}

class SafetyMenu extends StatelessWidget {
  final AppState m;
  final String kind, id;
  const SafetyMenu(this.m, this.kind, this.id, {super.key});
  @override
  Widget build(BuildContext c) => PopupMenuButton<String>(
    tooltip: '신고 또는 차단',
    icon: const Icon(Icons.more_horiz, size: 20),
    onSelected: (v) async {
      if (v == 'report') {
        open(c, ReportForm(m, kind, id));
      } else if (await confirm(
        c,
        '이 작성자를 차단할까요?',
        '이 회원이 쓴 게시글과 댓글이 내 화면에서 숨겨집니다. 익명 작성자의 신원은 공개되지 않습니다.',
        action: '차단',
      )) {
        try {
          await m.mutate(
            '/me/blocks',
            body: {'targetKind': kind, 'targetId': id},
          );
          if (c.mounted) message(c, '작성자를 차단했습니다.');
        } catch (e) {
          if (c.mounted) message(c, e);
        }
      }
    },
    itemBuilder: (_) => const [
      PopupMenuItem(value: 'report', child: Text('신고')),
      PopupMenuItem(value: 'block', child: Text('작성자 차단')),
    ],
  );
}

class ReportForm extends StatefulWidget {
  final AppState m;
  final String kind, id;
  const ReportForm(this.m, this.kind, this.id, {super.key});
  @override
  State<ReportForm> createState() => _ReportFormState();
}

class _ReportFormState extends State<ReportForm> {
  String reason = '욕설·괴롭힘';
  final detail = TextEditingController();
  @override
  void dispose() {
    detail.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Sheet('신고하기', [
    note('신고 내용은 운영진에게만 전달됩니다.'),
    gap(),
    DropdownButtonFormField<String>(
      initialValue: reason,
      items: [
        for (final v in ['욕설·괴롭힘', '음란·폭력', '개인정보', '스팸', '기타'])
          DropdownMenuItem(value: v, child: Text(v)),
      ],
      onChanged: (v) => reason = v!,
    ),
    gap(),
    TextField(
      controller: detail,
      minLines: 4,
      maxLines: 8,
      maxLength: 1000,
      decoration: const InputDecoration(labelText: '추가 설명 (선택)'),
    ),
    gap(),
    ActionButton('신고 보내기', () async {
      await widget.m.api.call(
        '/reports',
        method: 'POST',
        body: {
          'targetKind': widget.kind,
          'targetId': widget.id,
          'reason': reason,
          'detail': detail.text.trim(),
        },
      );
      if (c.mounted) {
        Navigator.pop(c);
        message(c, '신고가 접수되었습니다.');
      }
    }),
  ]);
}

class ReportsPage extends StatefulWidget {
  final AppState m;
  const ReportsPage(this.m, {super.key});
  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> {
  late Future<dynamic> result;
  @override
  void initState() {
    super.initState();
    result = widget.m.api.call('/staff/reports');
  }

  void reload() => setState(() => result = widget.m.api.call('/staff/reports'));
  @override
  Widget build(BuildContext c) => Sheet('신고 관리', [
    note('새 신고를 확인하고 이용 수칙 위반 여부를 검토해주세요.'),
    gap(),
    FutureBuilder<dynamic>(
      future: result,
      builder: (c, s) {
        if (s.hasError) {
          return Column(
            children: [
              Text('${s.error}'),
              TextButton(onPressed: reload, child: const Text('다시 시도')),
            ],
          );
        }
        if (!s.hasData) return const Center(child: CircularProgressIndicator());
        final rows = s.data as List;
        return Column(
          children: [
            if (rows.isEmpty) note('접수된 신고가 없습니다.'),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      r['reason'],
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    gap(8),
                    Text(r['body']),
                    gap(8),
                    note(r['detail']),
                    if (r['status'] == 'pending') ...[
                      gap(12),
                      Row(
                        children: [
                          Expanded(
                            child: ActionButton('콘텐츠 숨기기', () async {
                              if (!await confirm(
                                c,
                                '콘텐츠를 숨길까요?',
                                '모든 회원의 게시판에서 해당 콘텐츠가 숨겨집니다.',
                                action: '숨기기',
                              )) {
                                return;
                              }
                              await widget.m.mutate(
                                '/staff/reports/${r['id']}',
                                method: 'PATCH',
                                body: {'action': 'remove'},
                              );
                              reload();
                            }),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: ActionButton('위반 아님', () async {
                              await widget.m.api.call(
                                '/staff/reports/${r['id']}',
                                method: 'PATCH',
                                body: {'action': 'dismiss'},
                              );
                              reload();
                            }, outlined: true),
                          ),
                        ],
                      ),
                    ] else
                      note(r['status'] == 'remove' ? '숨김 처리됨' : '검토 완료'),
                    const Divider(height: 30),
                  ],
                ),
              ),
          ],
        );
      },
    ),
  ]);
}
