import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:image_picker/image_picker.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'api.dart';
part 'schedule.dart';
part 'community.dart';
part 'settings.dart';

const navy = Color(0xff1f305b),
    red = Color(0xffae1744),
    mist = Color(0xfff6f7fb),
    muted = Color(0xff73809c);
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(SaiApp(model: AppState(Api())));
}

ThemeData saiTheme(String choice) {
  final dark = choice == 'dark';
  final scheme =
      ColorScheme.fromSeed(
        seedColor: navy,
        brightness: dark ? Brightness.dark : Brightness.light,
      ).copyWith(
        primary: dark ? const Color(0xffb7c8ee) : navy,
        secondary: dark ? const Color(0xffef91ac) : red,
        surface: dark ? const Color(0xff182337) : Colors.white,
        onSurface: dark ? const Color(0xffeef2fc) : navy,
      );
  return ThemeData(
    useMaterial3: true,
    fontFamily: 'NotoSansKR',
    colorScheme: scheme,
    scaffoldBackgroundColor: dark
        ? const Color(0xff111b2c)
        : choice == 'blue'
        ? const Color(0xffeef3fc)
        : mist,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      foregroundColor: scheme.onSurface,
      centerTitle: false,
      elevation: 0,
    ),
    textTheme: Typography.material2021().black.apply(
      fontFamily: 'NotoSansKR',
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(
          color: scheme.outlineVariant.withValues(alpha: .6),
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(
          fontFamily: 'NotoSansKR',
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    dividerColor: dark ? const Color(0xff34425b) : const Color(0xffdce3ef),
    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant.withValues(alpha: .5),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      indicatorColor: Colors.transparent,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontFamily: 'NotoSansKR',
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w400,
          color: states.contains(WidgetState.selected)
              ? scheme.secondary
              : muted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(
          color: s.contains(WidgetState.selected) ? scheme.secondary : muted,
        ),
      ),
    ),
  );
}

class SaiApp extends StatefulWidget {
  final AppState model;
  const SaiApp({super.key, required this.model});
  @override
  State<SaiApp> createState() => _SaiAppState();
}

class _SaiAppState extends State<SaiApp> with WidgetsBindingObserver {
  AppState get m => widget.model;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    m.initialize();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      m.refresh();
      m.resume();
    } else {
      m.pause();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    m.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: m,
    builder: (context, _) => MaterialApp(
      key: ValueKey(m.user?['id'] ?? 'guest'),
      debugShowCheckedModeBanner: false,
      title: 'SAI ROOM',
      theme: saiTheme(m.data?['preferences']?['theme'] ?? 'light'),
      locale: const Locale('ko'),
      supportedLocales: const [Locale('ko'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: m.loading
          ? const Launch()
          : m.user == null
          ? AuthPage(m)
          : !m.approved
          ? PendingPage(m)
          : HomeShell(m),
    ),
  );
}

class Launch extends StatelessWidget {
  const Launch({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset('assets/sai-logo.png', width: 76),
          const SizedBox(height: 24),
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ],
      ),
    ),
  );
}

void open(BuildContext c, Widget page) =>
    Navigator.of(c).push(MaterialPageRoute<void>(builder: (_) => page));
void message(BuildContext c, Object e) {
  if (c.mounted) {
    ScaffoldMessenger.of(c).showSnackBar(
      SnackBar(content: Text('$e'), behavior: SnackBarBehavior.floating),
    );
  }
}

Future<bool> confirm(
  BuildContext c,
  String title,
  String body, {
  String action = '확인',
}) async =>
    await showDialog<bool>(
      context: c,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: Text(action),
          ),
        ],
      ),
    ) ??
    false;

class ActionButton extends StatefulWidget {
  final String label;
  final Future<void> Function() action;
  final bool outlined;
  const ActionButton(
    this.label,
    this.action, {
    super.key,
    this.outlined = false,
  });
  @override
  State<ActionButton> createState() => _ActionButtonState();
}

class _ActionButtonState extends State<ActionButton> {
  bool busy = false;
  Future<void> run() async {
    setState(() => busy = true);
    try {
      await widget.action();
    } catch (e) {
      if (mounted) message(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) {
    final child = busy
        ? const SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Text(widget.label);
    return widget.outlined
        ? OutlinedButton(onPressed: busy ? null : run, child: child)
        : FilledButton(onPressed: busy ? null : run, child: child);
  }
}

class Sheet extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const Sheet(this.title, this.children, {super.key});
  @override
  Widget build(BuildContext c) => Scaffold(
    appBar: AppBar(
      title: Text(
        title,
        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
      children: children,
    ),
  );
}

Widget gap([double h = 20]) => SizedBox(height: h);
Widget label(String text) => Padding(
  padding: const EdgeInsets.only(bottom: 10, top: 12),
  child: Text(
    text,
    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
  ),
);
Widget note(String text) => Text(
  text,
  style: const TextStyle(color: muted, fontSize: 13, height: 1.65),
);
Widget section(String text) => Padding(
  padding: const EdgeInsets.only(top: 28, bottom: 12),
  child: Text(
    text,
    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
  ),
);

class AuthPage extends StatefulWidget {
  final AppState m;
  const AuthPage(this.m, {super.key});
  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final form = GlobalKey<FormState>();
  final name = TextEditingController(),
      student = TextEditingController(),
      email = TextEditingController(),
      password = TextEditingController(),
      code = TextEditingController();
  bool signup = false, secret = true, rules = false, operator = false;
  @override
  void dispose() {
    for (final c in [name, student, email, password, code]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Scaffold(
    backgroundColor: Colors.white,
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: ListView(
            padding: const EdgeInsets.all(28),
            children: [
              gap(12),
              Row(
                children: [
                  Image.asset('assets/sai-logo.png', width: 34),
                  const SizedBox(width: 10),
                  const Text(
                    'SAI ROOM',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      letterSpacing: .7,
                    ),
                  ),
                ],
              ),
              gap(64),
              const Text(
                '세종대학교 인공지능 동아리',
                style: TextStyle(fontSize: 11, color: muted),
              ),
              gap(12),
              Text(
                signup ? '회원가입' : '로그인',
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1,
                ),
              ),
              gap(8),
              if (signup) note('가입 후 운영진의 승인을 기다려주세요.'),
              gap(30),
              if (widget.m.error != null) note(widget.m.error!),
              Form(
                key: form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (signup) ...[
                      field(name, '이름'),
                      gap(16),
                      field(student, '학번'),
                      gap(16),
                    ],
                    field(email, '이메일', keyboard: TextInputType.emailAddress),
                    gap(16),
                    TextFormField(
                      controller: password,
                      obscureText: secret,
                      autofillHints: [
                        signup
                            ? AutofillHints.newPassword
                            : AutofillHints.password,
                      ],
                      decoration: InputDecoration(
                        labelText: '비밀번호',
                        floatingLabelBehavior: FloatingLabelBehavior.always,
                        helperText: signup ? '8자 이상' : null,
                        suffixIcon: IconButton(
                          tooltip: secret ? '비밀번호 보기' : '비밀번호 숨기기',
                          onPressed: () => setState(() => secret = !secret),
                          icon: Icon(
                            secret
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                      ),
                      validator: (v) => v == null || v.isEmpty
                          ? '비밀번호를 입력해주세요.'
                          : signup && v.length < 8
                          ? '8자 이상 입력해주세요.'
                          : null,
                    ),
                    if (signup) ...[
                      gap(12),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text(
                          '운영진으로 가입',
                          style: TextStyle(fontSize: 14),
                        ),
                        value: operator,
                        onChanged: (v) => setState(() => operator = v),
                      ),
                      if (operator) field(code, '운영진 코드', obscure: true),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: rules,
                        onChanged: (v) => setState(() => rules = v ?? false),
                        title: const Text(
                          '이용 수칙·개인정보 안내 확인',
                          style: TextStyle(fontSize: 13),
                        ),
                      ),
                      TextButton(
                        onPressed: () => open(c, PolicyPage(widget.m)),
                        child: const Text('내용 보기'),
                      ),
                    ],
                    gap(24),
                    ActionButton(signup ? '회원가입' : '로그인', () async {
                      if (!form.currentState!.validate()) return;
                      if (signup) {
                        if (!rules) {
                          message(c, '이용 수칙과 개인정보 안내를 확인해주세요.');
                          return;
                        }
                        await widget.m.api.preauth();
                        await widget.m.api.call(
                          '/auth/signup',
                          method: 'POST',
                          body: {
                            'displayName': name.text.trim(),
                            'studentId': student.text.trim(),
                            'email': email.text.trim(),
                            'password': password.text,
                            'operatorCode': operator ? code.text.trim() : '',
                          },
                        );
                        if (mounted) {
                          password.clear();
                          setState(() => signup = false);
                          if (c.mounted) {
                            message(
                              c,
                              '가입 신청을 보냈습니다. 승인 상태는 로그인 후 확인할 수 있습니다.',
                            );
                          }
                        }
                      } else {
                        await widget.m.login(email.text.trim(), password.text);
                      }
                    }),
                    gap(12),
                    TextButton(
                      onPressed: () => setState(() {
                        signup = !signup;
                        password.clear();
                      }),
                      child: Text(signup ? '이미 계정이 있어요' : '회원가입'),
                    ),
                    if (!signup)
                      TextButton(
                        onPressed: () => open(c, PolicyPage(widget.m)),
                        child: const Text('개인정보 · 이용 수칙'),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  Widget field(
    TextEditingController ctrl,
    String title, {
    bool obscure = false,
    TextInputType? keyboard,
  }) => TextFormField(
    controller: ctrl,
    obscureText: obscure,
    keyboardType: keyboard,
    autocorrect: false,
    textInputAction: TextInputAction.next,
    decoration: InputDecoration(
      labelText: title,
      floatingLabelBehavior: FloatingLabelBehavior.always,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    ),
    validator: (v) => v == null || v.trim().isEmpty
        ? '$title 항목을 입력해주세요.'
        : title == '이메일' && !v.contains('@')
        ? '이메일을 확인해주세요.'
        : null,
  );
}

class PendingPage extends StatelessWidget {
  final AppState m;
  const PendingPage(this.m, {super.key});
  @override
  Widget build(BuildContext c) => Sheet('SAI ROOM', [
    gap(60),
    const Icon(Icons.hourglass_empty_rounded, size: 42),
    gap(24),
    Text(
      m.user?['membershipStatus'] == 'rejected'
          ? '가입 신청이 승인되지 않았습니다.'
          : '가입 승인을 기다리고 있어요.',
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
    ),
    gap(16),
    note('운영진이 신청 내용을 확인하면 동방 서비스를 사용할 수 있습니다.'),
    gap(28),
    ActionButton('승인 상태 확인', m.refresh),
    ActionButton('로그아웃', m.signout, outlined: true),
    TextButton(
      onPressed: () => open(c, DeleteAccount(m)),
      child: const Text('계정 삭제'),
    ),
    TextButton(
      onPressed: () => open(c, PolicyPage(m)),
      child: const Text('개인정보 안내'),
    ),
  ]);
}

class HomeShell extends StatefulWidget {
  final AppState m;
  const HomeShell(this.m, {super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int index = 0;
  @override
  void initState() {
    super.initState();
    widget.m.resume();
  }

  @override
  Widget build(BuildContext c) => Scaffold(
    appBar: AppBar(
      title: Image.asset('assets/sai-logo.png', width: 34, height: 34),
      actions: [
        IconButton(
          tooltip: '새로고침',
          onPressed: widget.m.refresh,
          icon: const Icon(Icons.refresh_rounded),
        ),
        IconButton(
          tooltip: '설정',
          onPressed: () => open(c, SettingsPage(widget.m)),
          icon: const Icon(Icons.tune_rounded),
        ),
        const SizedBox(width: 10),
      ],
    ),
    body: SafeArea(
      top: false,
      bottom: false,
      child: IndexedStack(
        index: index,
        children: [
          RoomPage(
            widget.m,
            active: index == 0,
            onReserve: () => setState(() => index = 1),
          ),
          SchedulePage(widget.m),
          BoardPage(widget.m),
          BoardPage(widget.m, inquiry: true),
        ],
      ),
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: index,
      onDestinationSelected: (i) => setState(() => index = i),
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home_rounded),
          label: '동방',
        ),
        NavigationDestination(
          icon: Icon(Icons.calendar_month_outlined),
          label: '예약',
        ),
        NavigationDestination(
          icon: Icon(Icons.chat_bubble_outline_rounded),
          label: '게시판',
        ),
        NavigationDestination(icon: Icon(Icons.forum_outlined), label: '문의함'),
      ],
    ),
  );
}

class RoomPage extends StatefulWidget {
  final AppState m;
  final VoidCallback onReserve;
  final bool active;
  const RoomPage(
    this.m, {
    super.key,
    required this.onReserve,
    this.active = true,
  });
  @override
  State<RoomPage> createState() => _RoomPageState();
}

class _RoomPageState extends State<RoomPage> with WidgetsBindingObserver {
  bool motion = false;
  bool foreground = true;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    setState(() {
      foreground = state == AppLifecycleState.resumed;
      if (!foreground) motion = false;
    });
    if (!foreground) native.invokeMethod('motionStop');
  }

  @override
  void didUpdateWidget(covariant RoomPage old) {
    super.didUpdateWidget(old);
    if (!widget.active && motion) {
      motion = false;
      native.invokeMethod('motionStop');
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext c) {
    final m = widget.m, p = m.presence;
    return RefreshIndicator(
      onRefresh: m.refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(24, 10, 24, 32),
        children: [
          Row(
            children: [
              const Text(
                '동방 현황',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -.7,
                ),
              ),
              const Spacer(),
              note(m.error == null ? '● 연결됨' : '연결 확인'),
            ],
          ),
          if (m.error != null) ...[gap(10), note(m.error!)],
          SizedBox(
            height: 350,
            child: BottleView(m, active: widget.active && foreground),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                '${p?['count'] ?? '—'}',
                style: const TextStyle(
                  fontSize: 42,
                  fontWeight: FontWeight.w700,
                  height: 1.1,
                ),
              ),
              const SizedBox(width: 8),
              note('명 이용 중'),
              const Spacer(),
              TextButton(
                onPressed: () => open(
                  c,
                  Sheet('동방에 있는 회원', [
                    for (final member in p?['members'] ?? [])
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.person_outline_rounded),
                        title: Text(member['displayName']),
                        trailing: member['isSelf'] == true
                            ? const Text('나')
                            : null,
                      ),
                    if ((p?['members'] ?? []).isEmpty)
                      note('현재 이용 중인 회원이 없습니다.'),
                  ]),
                ),
                child: const Text('전체 보기 ›'),
              ),
            ],
          ),
          gap(24),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Theme.of(c).colorScheme.surface,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p?['checkedIn'] == true ? '동방에 있어요' : '동방에 도착했나요?',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      gap(5),
                      note('직접 기록 · 4시간 유지'),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                ActionButton(p?['checkedIn'] == true ? '퇴실' : '입실', () async {
                  await m.mutate(
                    '/me/presence',
                    method: p?['checkedIn'] == true ? 'DELETE' : 'POST',
                  );
                }),
              ],
            ),
          ),
          gap(10),
          Row(
            children: [
              Expanded(
                child: TextButton.icon(
                  onPressed: () async {
                    try {
                      await native.invokeMethod(
                        motion ? 'motionStop' : 'motionStart',
                      );
                      setState(() => motion = !motion);
                    } catch (e) {
                      if (c.mounted) message(c, '기기 움직임을 사용할 수 없습니다.');
                    }
                  },
                  icon: Icon(
                    motion ? Icons.sensors : Icons.screen_rotation_outlined,
                    size: 18,
                  ),
                  label: Text(motion ? '움직임 켜짐' : '기기 움직임'),
                ),
              ),
              Expanded(
                child: TextButton(
                  onPressed: () => open(c, BallPage(m)),
                  child: const Text('내 공 꾸미기 ›'),
                ),
              ),
            ],
          ),
          const Divider(height: 28),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.calendar_month_outlined),
            title: const Text(
              '예약하기',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: const Text(
              '주간 시간표에서 빈 시간을 확인하세요',
              style: TextStyle(fontSize: 12),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: widget.onReserve,
          ),
          if (m.admin)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('회원 승인'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => open(c, MembersPage(m)),
            ),
          if (m.staff)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('신고 관리'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => open(c, ReportsPage(m)),
            ),
        ],
      ),
    );
  }
}

class BottleView extends StatefulWidget {
  final AppState m;
  final bool active;
  const BottleView(this.m, {super.key, this.active = true});
  @override
  State<BottleView> createState() => _BottleViewState();
}

class _BottleViewState extends State<BottleView> {
  late WebViewController controller;
  bool ready = false;
  int revision = 0;
  StreamSubscription<dynamic>? motion;
  String? error;
  final Map<String, String> images = {};
  @override
  void initState() {
    super.initState();
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel(
        'SaiScene',
        onMessageReceived: (msg) {
          if (msg.message == 'ready') {
            ready = true;
            sync();
          } else if (msg.message == 'members') {
            open(
              context,
              Sheet('동방에 있는 회원', [
                for (final member in widget.m.presence?['members'] ?? [])
                  ListTile(
                    title: Text(member['displayName']),
                    trailing: member['isSelf'] == true ? const Text('나') : null,
                  ),
              ]),
            );
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (r) =>
              r.url.startsWith('file:') ||
                  r.url.startsWith('https://appassets.androidplatform.net/')
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
          onWebResourceError: (e) {
            if (e.isForMainFrame == true && mounted) {
              setState(() => error = '3D 화면을 불러오지 못했습니다.');
            }
          },
        ),
      )
      ..loadFlutterAsset('assets/scene/index.html');
    motion = const EventChannel('kr.ac.sejong.sai/motion')
        .receiveBroadcastStream()
        .listen((v) {
          if (ready && mounted) {
            controller.runJavaScript(
              'tiltScene(${(v[0] as num).clamp(-.8, .8)},${(v[1] as num).clamp(-2, 2)});',
            );
          }
        }, onError: (_) {});
  }

  @override
  void didUpdateWidget(covariant BottleView old) {
    super.didUpdateWidget(old);
    sync();
  }

  Future<void> sync() async {
    if (!ready || !mounted) return;
    final id = ++revision;
    final p = widget.m.presence;
    if (p == null) return;
    final members = <Json>[];
    for (final original in p['members'] ?? []) {
      final member = Map<String, dynamic>.from(original),
          ball = Map<String, dynamic>.from(original['ball'] ?? {});
      final path = ball['imageUrl'];
      if (path != null) {
        try {
          images[path] ??=
              'data:image/png;base64,${base64Encode(await widget.m.api.image(path))}';
          ball['imageUrl'] = images[path];
        } catch (_) {
          ball['imageUrl'] = null;
        }
      }
      member['ball'] = ball;
      members.add(member);
    }
    if (!mounted || id != revision) return;
    final payload = {
      ...p,
      'members': members,
      'material':
          const {
            'water': 'glass',
            'basic': 'frost',
            'lava': 'ceramic',
          }[widget.m.data?['preferences']?['gauge']] ??
          'glass',
      'theme': widget.m.data?['preferences']?['theme'] ?? 'light',
      'reduced': MediaQuery.disableAnimationsOf(context),
      'paused': !widget.active,
    };
    await controller.runJavaScript('updateScene(${jsonEncode(payload)});');
  }

  @override
  void dispose() {
    motion?.cancel();
    native.invokeMethod('motionStop');
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => error != null
      ? Center(child: Text(error!))
      : Semantics(
          label: '동방 현황 입체 모형. ${widget.m.presence?['count'] ?? 0}명 이용 중',
          child: WebViewWidget(controller: controller),
        );
}
