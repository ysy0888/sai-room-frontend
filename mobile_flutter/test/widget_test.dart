import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sai_room/api.dart';
import 'package:sai_room/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          native,
          (call) async =>
              call.method == 'beaconStatus' ? {'paired': false} : null,
        );
  });
  AppState model() => AppState(
    Api(
      client: MockClient(
        (r) async => http.Response(
          jsonEncode({
            'error': {'code': 'AUTH_REQUIRED'},
          }),
          401,
        ),
      ),
    ),
  );
  testWidgets(
    'login and signup remain readable on a narrow screen and accept Hangul composition',
    (tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final m = model();
      await tester.pumpWidget(SaiApp(model: m));
      await tester.pumpAndSettle();
      expect(find.text('SAI ROOM'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, '회원가입'));
      await tester.pumpAndSettle();
      final field = find.byType(TextFormField).first;
      await tester.showKeyboard(field);
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: '상',
          selection: TextSelection.collapsed(offset: 1),
          composing: TextRange(start: 0, end: 1),
        ),
      );
      await tester.pump();
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: '상원',
          selection: TextSelection.collapsed(offset: 2),
        ),
      );
      await tester.pump();
      expect(find.text('상원'), findsOneWidget);
      expect(find.text('8자 이상'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'weekly schedule exposes all seven days and booking controls without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final m = model();
      m.data = {
        'user': {
          'id': 'test',
          'displayName': '테스트',
          'role': 'member',
          'membershipStatus': 'approved',
        },
        'bookings': [],
        'posts': [],
      };
      await tester.pumpWidget(
        MaterialApp(
          theme: saiTheme('light'),
          home: Scaffold(body: SchedulePage(m)),
        ),
      );
      await tester.pumpAndSettle();
      for (final day in ['월', '화', '수', '목', '금', '토', '일']) {
        expect(find.text(day), findsOneWidget);
      }
      expect(find.text('예약하기'), findsOneWidget);
      await tester.tap(find.text('일간'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      m.dispose();
    },
  );
  test(
    'API preserves Korean JSON and never follows an auth redirect',
    () async {
      final calls = <http.Request>[];
      final api = Api(
        client: MockClient((r) async {
          calls.add(r);
          return http.Response.bytes(
            utf8.encode(jsonEncode({'title': '상원 스터디'})),
            200,
          );
        }),
      );
      api.cookie = 'sai_session=isolated';
      api.csrf = 'csrf';
      final result = await api.call(
        '/posts',
        method: 'POST',
        body: {'title': '상원 스터디'},
      );
      expect(result['title'], '상원 스터디');
      expect(jsonDecode(calls.single.body)['title'], '상원 스터디');
      expect(calls.single.followRedirects, false);
      expect(calls.single.headers['cookie'], 'sai_session=isolated');
      api.client.close();
    },
  );
}
