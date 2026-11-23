import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sai_room/api.dart';
import 'package:sai_room/main.dart';
import 'package:webview_flutter/webview_flutter.dart';

class PreviewApi extends Api {
  bool signedIn = false;
  int count = 7;
  @override
  Future<void> restore() async {}
  @override
  Future<void> forget() async {}
  @override
  Future<dynamic> call(String path, {String method = 'GET', Json? body}) async {
    if (path == '/auth/csrf') return {'csrfToken': 'isolated-quality-test'};
    if (path == '/auth/login') {
      signedIn = true;
      return null;
    }
    if (path == '/bootstrap') {
      if (!signedIn) throw const ApiFailure('AUTH_REQUIRED', 401);
      final today = dayOnly(seoulNow());
      final monday = today.subtract(Duration(days: today.weekday - 1));
      return {
        'user': {
          'id': 'quality-member',
          'displayName': '김상원',
          'role': 'admin',
          'membershipStatus': 'approved',
        },
        'csrfToken': 'isolated-quality-test',
        'bookings': [
          {
            'id': 'fixture-study',
            'date': dateKey(monday.add(const Duration(days: 1))),
            'start': 780,
            'end': 900,
            'purpose': '논문 스터디',
            'name': '스터디 팀',
            'people': 4,
            'owner': 'me',
          },
          {
            'id': 'fixture-meeting',
            'date': dateKey(monday.add(const Duration(days: 3))),
            'start': 1080,
            'end': 1200,
            'purpose': '운영진 회의',
            'name': '운영진',
            'people': 5,
            'owner': 'other',
          },
        ],
        'posts': [],
        'preferences': {'theme': 'light', 'gauge': 'water'},
        'ball': {'anonymous': false, 'color': '#233f6d'},
        'communityAccepted': true,
      };
    }
    if (path == '/rooms/sai-room/occupants') {
      return {
        'count': count,
        'referenceCapacity': 15,
        'sequence': count,
        'checkedIn': true,
        'members': List.generate(
          count,
          (i) => {
            'id': 'fixture-$i',
            'displayName': [
              '김상원',
              '이서연',
              '박지훈',
              '최유진',
              '정민수',
              '강하은',
              '윤도현',
            ][i % 7],
            'isSelf': i == 0,
            'ball': {
              'anonymous': false,
              'color': [
                '#233f6d',
                '#ae1744',
                '#6588a6',
                '#3e7e79',
                '#d29c6b',
                '#9b81a9',
                '#637068',
              ][i % 7],
            },
          },
        ),
      };
    }
    if (path == '/beacon/config') return {'enabled': false, 'paired': false};
    return [];
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  Future<void> shot(String name) async {
    final bytes = await binding.takeScreenshot(name);
    await File(
      '${Directory.systemTemp.path}/sai-$name.png',
    ).writeAsBytes(bytes);
  }

  testWidgets(
    'quality gate: login, real 3D, density, weekly timetable and native settings',
    (tester) async {
      final api = PreviewApi();
      final m = AppState(api);
      await tester.pumpWidget(SaiApp(model: m));
      await tester.pumpAndSettle();
      await shot('login');
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'quality@example.test',
      );
      await tester.enterText(find.byType(TextFormField).at(1), 'Quality-1234');
      await tester.tap(find.widgetWithText(FilledButton, '로그인'));
      await tester.pumpAndSettle();
      await Future<void>.delayed(const Duration(seconds: 6));
      await tester.pump();
      final dynamic scene = tester.state(find.byType(BottleView));
      final controller = scene.controller as WebViewController;
      final result = await controller.runJavaScriptReturningResult(
        'JSON.stringify({canvas:!!document.querySelector("canvas"),balls:document.querySelectorAll(".bottle-tag").length,material:document.querySelector(".member-bottle")?.dataset.material})',
      );
      expect('$result', contains('true'));
      expect('$result', contains('7'));
      await shot('home-7');
      api.count = 15;
      await m.poll();
      await tester.pump();
      await Future<void>.delayed(const Duration(seconds: 6));
      await tester.pump();
      await shot('home-15');
      api.count = 0;
      await m.poll();
      await tester.pump();
      await Future<void>.delayed(const Duration(seconds: 3));
      await tester.pump();
      await shot('home-empty');
      await tester.tap(find.text('예약').last);
      await tester.pumpAndSettle();
      await shot('schedule-week');
      for (final d in ['월', '화', '수', '목', '금', '토', '일']) {
        expect(find.text(d), findsOneWidget);
      }
      await tester.tap(find.byTooltip('설정'));
      await tester.pumpAndSettle();
      await shot('settings');
      expect(tester.takeException(), isNull);
      await File('${Directory.systemTemp.path}/sai-quality.json').writeAsString(
        jsonEncode({
          'webgl': result,
          'screens': [
            'login',
            'home-7',
            'home-15',
            'home-empty',
            'schedule-week',
            'settings',
          ],
        }),
      );
      m.pause();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
}
