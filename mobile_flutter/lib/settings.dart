part of 'main.dart';

class SettingsPage extends StatelessWidget {
  final AppState m;
  const SettingsPage(this.m, {super.key});
  @override
  Widget build(BuildContext c) => Sheet('설정', [
    Text(
      m.user?['displayName'] ?? '회원',
      style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700),
    ),
    gap(6),
    note(
      m.admin
          ? '관리자'
          : m.staff
          ? '운영진'
          : '회원',
    ),
    section('내 계정'),
    tile(c, '자동 입퇴실', BeaconPage(m), Icons.sensors),
    tile(c, '내 공 꾸미기', BallPage(m), Icons.circle_outlined),
    tile(c, '차단 관리', BlocksPage(m), Icons.block_outlined),
    section('화면'),
    tile(c, '테마·통 스타일', AppearancePage(m), Icons.palette_outlined),
    if (m.staff) ...[
      section('동아리 운영'),
      tile(c, '운영진 가입 코드', OperatorCodePage(m), Icons.key_outlined),
      tile(c, '신고 관리', ReportsPage(m), Icons.flag_outlined),
      if (m.admin)
        tile(c, '회원 승인·관리자 양도', MembersPage(m), Icons.group_outlined),
    ],
    section('안내'),
    tile(c, '개인정보·이용 수칙', PolicyPage(m), Icons.policy_outlined),
    gap(24),
    ActionButton('로그아웃', () async {
      if (await confirm(
        c,
        '로그아웃할까요?',
        '이 휴대폰의 자동 입퇴실 연결도 해제합니다.',
        action: '로그아웃',
      )) {
        await m.signout();
      }
    }, outlined: true),
    gap(12),
    TextButton(
      onPressed: () => open(c, DeleteAccount(m)),
      child: const Text('회원 탈퇴', style: TextStyle(color: muted)),
    ),
    gap(18),
    Center(child: note('SAI ROOM · 2.0.0')),
  ]);
  Widget tile(BuildContext c, String name, Widget page, IconData icon) =>
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon, size: 22),
        title: Text(name, style: const TextStyle(fontSize: 15)),
        trailing: const Icon(Icons.chevron_right, size: 20),
        onTap: () => open(c, page),
      );
}

const privacyText =
    'SAI ROOM은 세종대학교 인공지능 동아리 SAI의 회원을 위한 서비스입니다.\n\n계정과 회원 승인\n이름, 학번, 이메일, 비밀번호 해시, 역할과 승인 상태를 보관합니다. 비밀번호 원문은 저장하지 않습니다.\n\n동방 서비스\n예약, 게시글·댓글, 운영진 문의, 공 이미지, 화면 설정과 현재 입퇴실 상태를 처리합니다. 일반 회원은 본인이 작성한 문의만, 운영진은 회원 문의를 확인할 수 있습니다. 게시판은 익명으로 표시되지만 운영을 위해 서버에서는 작성 계정과 연결됩니다.\n\n자동 입퇴실 (선택)\n동의한 휴대폰에서 동방 비콘 식별자와 입실·퇴실 상태, 관측 시각을 전송합니다. 휴대폰의 위도·경도나 이동 경로를 수집하지 않습니다. 휴대폰의 위치 권한은 비콘 감지를 위해 필요합니다. 기기 인증 키는 Keychain 또는 Android Keystore로 보호합니다. 자동 입퇴실을 끄거나 앱 권한을 취소할 수 있습니다.\n\n보관과 삭제\n설정의 회원 탈퇴 또는 웹사이트의 계정 삭제 화면에서 본인 비밀번호를 확인하면 계정, 직접 작성한 글·댓글·문의, 예약, 이미지와 기기 인증이 삭제됩니다. 다른 회원이 해당 글에 남긴 댓글도 함께 삭제됩니다. 운영 서버의 백업과 서비스 제공자의 보안 로그에는 제공자의 보관 정책이 적용될 수 있습니다.\n\n서비스 운영\nVercel 서버와 Supabase 데이터베이스를 이용합니다. 앱 데이터베이스는 서울 리전에 있습니다. 지원이 필요하면 문의함에서 운영진에게 연락해주세요.';
const rulesText =
    '서로를 존중해주세요. 욕설·괴롭힘, 협박, 음란·폭력 콘텐츠, 타인의 개인정보, 스팸과 불법 콘텐츠를 허용하지 않습니다.\n\n게시글·댓글의 더보기에서 신고하거나 작성자를 차단할 수 있습니다. 신고는 운영진만 확인하며, 위반 콘텐츠는 숨김 처리됩니다. 차단은 설정에서 해제할 수 있습니다.\n\n운영진 문의는 작성자와 운영진에게만 표시됩니다. 긴급한 상황을 위한 신고 서비스는 아닙니다.\n\n비콘은 근접 신호이며 출석을 증명하는 장치가 아닙니다. 권한, 블루투스, 절전 또는 앱 강제 종료 상태에 따라 자동 감지가 늦거나 멈출 수 있습니다. 직접 입·퇴실 버튼으로 상태를 수정할 수 있습니다.';

class PolicyPage extends StatelessWidget {
  final AppState m;
  const PolicyPage(this.m, {super.key});
  @override
  Widget build(BuildContext c) => Sheet('개인정보·이용 수칙', [
    note('안내 버전 $policyVersion'),
    section('개인정보 안내'),
    SelectableText(
      privacyText,
      style: const TextStyle(fontSize: 14, height: 1.85),
    ),
    section('커뮤니티 이용 수칙'),
    SelectableText(
      rulesText,
      style: const TextStyle(fontSize: 14, height: 1.85),
    ),
    gap(28),
    if (m.approved)
      ActionButton(
        m.data?['communityAccepted'] == true ? '이용 수칙 동의됨' : '이용 수칙에 동의',
        () async {
          await m.mutate(
            '/me/community-consent',
            body: {'version': policyVersion},
          );
          if (c.mounted) message(c, '동의 내용을 저장했습니다.');
        },
        outlined: true,
      ),
  ]);
}

class DeleteAccount extends StatefulWidget {
  final AppState m;
  const DeleteAccount(this.m, {super.key});
  @override
  State<DeleteAccount> createState() => _DeleteAccountState();
}

class _DeleteAccountState extends State<DeleteAccount> {
  final password = TextEditingController();
  bool checked = false;
  @override
  void dispose() {
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Sheet('회원 탈퇴', [
    section('계정과 내 데이터를 삭제합니다.'),
    note(
      '내 예약, 게시글·댓글, 문의, 공 이미지와 입퇴실 연결이 삭제됩니다. 삭제 후 되돌릴 수 없습니다. 마지막 관리자는 먼저 다른 회원에게 관리자 권한을 넘겨주세요.',
    ),
    gap(24),
    TextField(
      controller: password,
      obscureText: true,
      decoration: const InputDecoration(labelText: '현재 비밀번호'),
    ),
    gap(16),
    CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      title: const Text('삭제되는 내용을 확인했습니다.', style: TextStyle(fontSize: 14)),
      value: checked,
      onChanged: (v) => setState(() => checked = v ?? false),
    ),
    gap(20),
    ActionButton('계정 삭제', () async {
      if (!checked || password.text.isEmpty) {
        message(c, '삭제 내용을 확인하고 비밀번호를 입력해주세요.');
        return;
      }
      if (!await confirm(
        c,
        '계정을 영구 삭제할까요?',
        '이 작업은 되돌릴 수 없습니다.',
        action: '영구 삭제',
      )) {
        return;
      }
      await widget.m.api.call(
        '/me/account',
        method: 'DELETE',
        body: {'currentPassword': password.text},
      );
      await native.invokeMethod('beaconDisable');
      await widget.m.api.forget();
      await widget.m.refresh();
    }),
  ]);
}

class BlocksPage extends StatefulWidget {
  final AppState m;
  const BlocksPage(this.m, {super.key});
  @override
  State<BlocksPage> createState() => _BlocksPageState();
}

class _BlocksPageState extends State<BlocksPage> {
  late Future<dynamic> result;
  @override
  void initState() {
    super.initState();
    result = widget.m.api.call('/me/blocks');
  }

  @override
  Widget build(BuildContext c) => Sheet('차단 관리', [
    note('익명 작성자의 신원은 표시하지 않습니다.'),
    gap(20),
    FutureBuilder<dynamic>(
      future: result,
      builder: (c, s) {
        if (s.hasError) return Text('${s.error}');
        if (!s.hasData) return const Center(child: CircularProgressIndicator());
        final rows = s.data as List;
        return Column(
          children: [
            if (rows.isEmpty) note('차단한 작성자가 없습니다.'),
            for (var i = 0; i < rows.length; i++)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('차단한 작성자 ${i + 1}'),
                trailing: ActionButton('해제', () async {
                  await widget.m.mutate(
                    '/me/blocks/${rows[i]['id']}',
                    method: 'DELETE',
                  );
                  setState(() => result = widget.m.api.call('/me/blocks'));
                }, outlined: true),
              ),
          ],
        );
      },
    ),
  ]);
}

class AppearancePage extends StatefulWidget {
  final AppState m;
  const AppearancePage(this.m, {super.key});
  @override
  State<AppearancePage> createState() => _AppearancePageState();
}

class _AppearancePageState extends State<AppearancePage> {
  late String theme, gauge;
  @override
  void initState() {
    super.initState();
    theme = widget.m.data?['preferences']?['theme'] ?? 'light';
    gauge = widget.m.data?['preferences']?['gauge'] ?? 'water';
  }

  @override
  Widget build(BuildContext c) => Sheet('화면 꾸미기', [
    section('테마'),
    for (final e in {
      'light': 'SAI 라이트',
      'dark': 'SAI 다크',
      'blue': '블루',
    }.entries)
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: e.key == 'dark'
                ? const Color(0xff182337)
                : e.key == 'blue'
                ? const Color(0xffe3ecfa)
                : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: muted.withValues(alpha: .3)),
          ),
        ),
        title: Text(e.value),
        trailing: theme == e.key
            ? const Icon(Icons.check_circle, color: red)
            : const Icon(Icons.circle_outlined, color: muted),
        onTap: () => setState(() => theme = e.key),
      ),
    section('통 스타일'),
    for (final e in {'water': '유리', 'basic': '무광', 'lava': '세라믹'}.entries)
      ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(e.value),
        trailing: gauge == e.key
            ? const Icon(Icons.check_circle, color: red)
            : const Icon(Icons.circle_outlined, color: muted),
        onTap: () => setState(() => gauge = e.key),
      ),
    gap(28),
    ActionButton('적용하기', () async {
      await widget.m.mutate(
        '/me/preferences',
        method: 'PATCH',
        body: {'theme': theme, 'gauge': gauge},
      );
      if (c.mounted) Navigator.pop(c);
    }),
  ]);
}

class BallPage extends StatefulWidget {
  final AppState m;
  const BallPage(this.m, {super.key});
  @override
  State<BallPage> createState() => _BallPageState();
}

class _BallPageState extends State<BallPage> {
  late bool anonymous;
  late String color;
  String? imageId;
  Uint8List? image;
  @override
  void initState() {
    super.initState();
    final b = widget.m.data?['ball'] ?? {};
    anonymous = b['anonymous'] ?? false;
    color = b['color'] ?? '#233f6d';
    imageId = b['imageId'];
    if (b['imageUrl'] != null) {
      widget.m.api
          .image(b['imageUrl'])
          .then((v) {
            if (mounted) setState(() => image = v);
          })
          .catchError((_) {});
    }
  }

  @override
  Widget build(BuildContext c) => Sheet('내 공 꾸미기', [
    gap(10),
    Center(
      child: Container(
        width: 150,
        height: 150,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Color(int.parse(color.replaceFirst('#', 'ff'), radix: 16)),
          image: image != null
              ? DecorationImage(image: MemoryImage(image!), fit: BoxFit.cover)
              : null,
          gradient: image == null
              ? RadialGradient(
                  center: const Alignment(-.35, -.5),
                  colors: [
                    Color(
                      int.parse(color.replaceFirst('#', 'ff'), radix: 16),
                    ).withValues(alpha: .5),
                    Color(int.parse(color.replaceFirst('#', 'ff'), radix: 16)),
                    const Color(0xff13264a),
                  ],
                )
              : null,
          boxShadow: [
            BoxShadow(
              color: navy.withValues(alpha: .16),
              blurRadius: 20,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: .25),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            anonymous ? '익명 회원' : widget.m.user?['displayName'] ?? '',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    ),
    gap(24),
    SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: const Text('이름 비공개'),
      subtitle: const Text(
        '공과 회원 목록에 익명 회원으로 표시합니다.',
        style: TextStyle(fontSize: 12),
      ),
      value: anonymous,
      onChanged: (v) => setState(() => anonymous = v),
    ),
    section('공 색상'),
    Wrap(
      spacing: 14,
      runSpacing: 14,
      children: [
        for (final v in [
          '#233f6d',
          '#ae1744',
          '#6588a6',
          '#3e7e79',
          '#d29c6b',
          '#9b81a9',
          '#637068',
          '#c6798d',
        ])
          Semantics(
            label: '공 색상 $v',
            selected: color == v,
            child: InkWell(
              borderRadius: BorderRadius.circular(24),
              onTap: () => setState(() => color = v),
              child: Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(int.parse(v.replaceFirst('#', 'ff'), radix: 16)),
                ),
                child: color == v
                    ? const Icon(Icons.check, color: Colors.white)
                    : null,
              ),
            ),
          ),
      ],
    ),
    section('이미지'),
    ActionButton(image == null ? '이미지 선택' : '이미지 바꾸기', () async {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      if (bytes.length > 5 * 1024 * 1024) {
        throw const ApiFailure('INVALID_IMAGE');
      }
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      final img = frame.image;
      final side = img.width < img.height ? img.width : img.height;
      final rec = ui.PictureRecorder();
      final canvas = Canvas(rec);
      canvas.drawImageRect(
        img,
        Rect.fromLTWH(
          (img.width - side) / 2,
          (img.height - side) / 2,
          side.toDouble(),
          side.toDouble(),
        ),
        const Rect.fromLTWH(0, 0, 256, 256),
        Paint()..filterQuality = FilterQuality.high,
      );
      final picture = rec.endRecording();
      final scaled = await picture.toImage(256, 256);
      final png = (await scaled.toByteData(
        format: ui.ImageByteFormat.png,
      ))!.buffer.asUint8List();
      img.dispose();
      scaled.dispose();
      picture.dispose();
      codec.dispose();
      final uploaded = await widget.m.api.call(
        '/me/ball-image',
        method: 'POST',
        body: {'imageData': 'data:image/png;base64,${base64Encode(png)}'},
      );
      if (mounted) {
        setState(() {
          image = png;
          imageId = uploaded['imageId'];
        });
      }
    }, outlined: true),
    if (image != null)
      TextButton(
        onPressed: () => setState(() {
          image = null;
          imageId = null;
        }),
        child: const Text('이미지 지우기'),
      ),
    gap(24),
    ActionButton('저장', () async {
      await widget.m.mutate(
        '/me/ball',
        method: 'PATCH',
        body: {'anonymous': anonymous, 'color': color, 'imageId': imageId},
      );
      if (c.mounted) Navigator.pop(c);
    }),
  ]);
}

class MembersPage extends StatefulWidget {
  final AppState m;
  const MembersPage(this.m, {super.key});
  @override
  State<MembersPage> createState() => _MembersPageState();
}

class _MembersPageState extends State<MembersPage> {
  late Future<dynamic> result;
  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() => result = widget.m.api.call('/admin/membership-applications');
  @override
  Widget build(BuildContext c) => Sheet('회원 관리', [
    FutureBuilder<dynamic>(
      future: result,
      builder: (c, s) {
        if (s.hasError) return Text('${s.error}');
        if (!s.hasData) return const Center(child: CircularProgressIndicator());
        final rows = s.data as List;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (rows.isEmpty) note('가입 신청이 없습니다.'),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      r['displayName'],
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    gap(6),
                    note('${r['studentId']} · ${r['email']}'),
                    note(
                      '${r['role'] == 'operator' ? '운영진' : '회원'} · ${r['membershipStatus'] == 'pending'
                          ? '승인 대기'
                          : r['membershipStatus'] == 'approved'
                          ? '승인됨'
                          : '거절됨'}',
                    ),
                    gap(10),
                    if (r['membershipStatus'] == 'pending')
                      Row(
                        children: [
                          Expanded(
                            child: ActionButton('승인', () async {
                              await widget.m.api.call(
                                '/admin/membership-applications/${r['id']}',
                                method: 'PATCH',
                                body: {'membershipStatus': 'approved'},
                              );
                              setState(reload);
                            }),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: ActionButton('거절', () async {
                              if (!await confirm(
                                c,
                                '가입을 거절할까요?',
                                r['displayName'],
                                action: '거절',
                              )) {
                                return;
                              }
                              await widget.m.api.call(
                                '/admin/membership-applications/${r['id']}',
                                method: 'PATCH',
                                body: {'membershipStatus': 'rejected'},
                              );
                              setState(reload);
                            }, outlined: true),
                          ),
                        ],
                      ),
                    if (r['membershipStatus'] == 'approved')
                      TextButton(
                        onPressed: () => open(c, TransferPage(widget.m, r)),
                        child: const Text('관리자 권한 양도'),
                      ),
                  ],
                ),
              ),
          ],
        );
      },
    ),
  ]);
}

class TransferPage extends StatefulWidget {
  final AppState m;
  final Json member;
  const TransferPage(this.m, this.member, {super.key});
  @override
  State<TransferPage> createState() => _TransferPageState();
}

class _TransferPageState extends State<TransferPage> {
  final password = TextEditingController();
  @override
  void dispose() {
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Sheet('관리자 권한 양도', [
    Text(
      '${widget.member['displayName']} 님에게 관리자 권한을 넘깁니다.',
      style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
    ),
    gap(18),
    note('내 계정은 운영진으로 변경됩니다. 새로운 관리자는 회원 승인과 관리자 권한 양도를 할 수 있습니다.'),
    gap(24),
    TextField(
      controller: password,
      obscureText: true,
      decoration: const InputDecoration(labelText: '내 비밀번호'),
    ),
    gap(24),
    ActionButton('권한 양도', () async {
      if (!await confirm(
        c,
        '관리자를 변경할까요?',
        widget.member['displayName'],
        action: '양도',
      )) {
        return;
      }
      await widget.m.mutate(
        '/admin/transfer',
        body: {'userId': widget.member['id'], 'currentPassword': password.text},
      );
      if (c.mounted) Navigator.of(c).popUntil((r) => r.isFirst);
    }),
  ]);
}

class OperatorCodePage extends StatefulWidget {
  final AppState m;
  const OperatorCodePage(this.m, {super.key});
  @override
  State<OperatorCodePage> createState() => _OperatorCodePageState();
}

class _OperatorCodePageState extends State<OperatorCodePage> {
  final code = TextEditingController(),
      repeat = TextEditingController(),
      password = TextEditingController();
  late Future<dynamic> info;
  @override
  void initState() {
    super.initState();
    info = widget.m.api.call('/staff/operator-code');
  }

  @override
  void dispose() {
    code.dispose();
    repeat.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Sheet('운영진 가입 코드', [
    note('새 코드를 저장하면 이전 코드는 사용할 수 없습니다. 기존 회원의 권한은 유지됩니다.'),
    gap(24),
    FutureBuilder<dynamic>(
      future: info,
      builder: (c, s) {
        if (s.hasError) return Text('${s.error}');
        if (!s.hasData) return const CircularProgressIndicator();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: code,
              obscureText: true,
              decoration: const InputDecoration(labelText: '새 코드 · 12자 이상'),
            ),
            gap(16),
            TextField(
              controller: repeat,
              obscureText: true,
              decoration: const InputDecoration(labelText: '새 코드 확인'),
            ),
            gap(16),
            TextField(
              controller: password,
              obscureText: true,
              decoration: const InputDecoration(labelText: '내 비밀번호'),
            ),
            gap(24),
            ActionButton('코드 변경', () async {
              if (code.text.trim().length < 12 || code.text != repeat.text) {
                message(c, '12자 이상의 코드와 확인 값을 맞춰주세요.');
                return;
              }
              try {
                await widget.m.api.call(
                  '/staff/operator-code',
                  method: 'PUT',
                  body: {
                    'newCode': code.text.trim(),
                    'currentPassword': password.text,
                    'version': s.data['version'],
                  },
                );
                code.clear();
                repeat.clear();
                password.clear();
                if (c.mounted) message(c, '가입 코드를 변경했습니다.');
              } finally {
                if (mounted) {
                  setState(
                    () => info = widget.m.api.call('/staff/operator-code'),
                  );
                }
              }
            }),
          ],
        );
      },
    ),
  ]);
}

class BeaconPage extends StatefulWidget {
  final AppState m;
  const BeaconPage(this.m, {super.key});
  @override
  State<BeaconPage> createState() => _BeaconPageState();
}

class _BeaconPageState extends State<BeaconPage> with WidgetsBindingObserver {
  Json? config, status;
  String? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) load();
  }

  Future<void> load() async {
    try {
      final a = await widget.m.api.call('/beacon/config');
      final b = await native.invokeMapMethod<String, dynamic>('beaconStatus');
      if (mounted) {
        setState(() {
          config = Json.from(a);
          status = b;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext c) => Sheet('자동 입퇴실', [
    gap(12),
    const Icon(Icons.sensors_rounded, size: 46, color: navy),
    gap(24),
    const Text(
      '들어오면 입실,\n나가면 퇴실.',
      style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, height: 1.35),
    ),
    gap(20),
    note(
      '동방의 비콘 신호를 휴대폰에서 감지합니다. 앱 화면을 닫아도 동작하도록 위치·블루투스 권한이 필요합니다. 위치 좌표나 이동 경로는 수집하지 않습니다.',
    ),
    gap(24),
    if (error != null) Text(error!),
    if (config == null && error == null)
      const Center(child: CircularProgressIndicator()),
    if (config != null) ...[
      Text(
        config!['enabled'] != true
            ? '비콘 설치 준비 중'
            : status?['active'] == true
            ? '자동 입퇴실 켜짐'
            : status?['paired'] == true
            ? '권한 또는 블루투스를 확인해주세요.'
            : '자동 입퇴실 꺼짐',
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
      ),
      gap(12),
      if (status?['message'] != null) note(status!['message']),
      if (config!['enabled'] == true && status?['paired'] != true) ...[
        gap(16),
        ActionButton('동의하고 자동 입퇴실 켜기', () async {
          if (!await confirm(
            c,
            '백그라운드 감지에 동의하나요?',
            '동방 비콘 식별자, 입·퇴실 상태와 관측 시각을 서버로 보냅니다. iPhone은 위치 접근을 항상 허용해야 하며 Android는 감지 중 알림이 표시됩니다. 설정에서 언제든 끌 수 있습니다.',
            action: '동의',
          )) {
            return;
          }
          final permissions = await native.invokeMapMethod<String, dynamic>(
            'beaconPermissions',
          );
          if (permissions?['ready'] != true) {
            await load();
            if (c.mounted) {
              message(c, permissions?['message'] ?? '기기 설정에서 감지 권한을 허용해주세요.');
            }
            return;
          }
          final paired = await widget.m.api.call(
            '/beacon/devices',
            method: 'POST',
            body: {
              'platform': Platform.isIOS ? 'ios' : 'android',
              'consent': true,
            },
          );
          try {
            await native.invokeMethod('beaconConfigure', {
              ...config!,
              'deviceToken': paired['deviceToken'],
              'apiOrigin': apiOrigin,
            });
          } catch (_) {
            await widget.m.api.call('/beacon/devices', method: 'DELETE');
            rethrow;
          }
          await load();
        }),
      ],
      if (status?['paired'] == true) ...[
        gap(16),
        ActionButton('자동 입퇴실 끄기', () async {
          await widget.m.api.call('/beacon/devices', method: 'DELETE');
          await native.invokeMethod('beaconDisable');
          await load();
          await widget.m.poll();
        }, outlined: true),
      ],
    ],
    gap(14),
    TextButton(
      onPressed: () async {
        await native.invokeMethod('openSettings');
      },
      child: const Text('휴대폰 권한 설정'),
    ),
    TextButton(onPressed: load, child: const Text('상태 새로고침')),
    gap(20),
    note(
      '강제 종료, 절전 설정, 권한 해제, 블루투스 꺼짐에 따라 감지가 멈출 수 있습니다. 신호가 잠깐 끊겨도 바로 퇴실로 처리하지 않으며, 필요하면 직접 입·퇴실 버튼으로 수정할 수 있습니다.',
    ),
  ]);
}
